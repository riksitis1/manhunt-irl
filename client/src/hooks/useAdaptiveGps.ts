import { useCallback, useEffect, useRef, useState } from 'react';
import type { Boundary, GeoPoint } from '@shared/types';
import { evaluateBoundaryClient } from '../lib/geo';

export interface AdaptiveGpsOptions {
  enabled: boolean;
  boundary: Boundary;
  batterySaver: boolean;
  /** Increment to force an immediate high-accuracy fix (e.g., on GPS ping round). */
  forcePingKey: number;
  onFix: (point: GeoPoint, isForcedPing: boolean) => void;
}

export interface AdaptiveGpsState {
  location: GeoPoint | null;
  insideBoundary: boolean;
  signedDistanceMeters: number;
  status: 'IDLE' | 'LOCATING' | 'LOCKED' | 'WEAK' | 'ERROR';
  error: string | null;
  triggerFreshFix: (isForcedPing?: boolean) => void;
}

/**
 * Battery-optimized adaptive GPS sampler:
 * Instead of running continuous 1Hz watchPosition (which drains phone batteries),
 * samples every 6s (or 12s in Battery Saver) when safely inside the block,
 * and tightens to 2s only when within 25m of the boundary edge or outside.
 */
export function useAdaptiveGps(options: AdaptiveGpsOptions): AdaptiveGpsState {
  const { enabled, boundary, batterySaver, forcePingKey, onFix } = options;

  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [insideBoundary, setInsideBoundary] = useState(true);
  const [signedDistanceMeters, setSignedDistanceMeters] = useState(Number.POSITIVE_INFINITY);
  const [status, setStatus] = useState<AdaptiveGpsState['status']>('IDLE');
  const [error, setError] = useState<string | null>(null);

  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;

  const batterySaverRef = useRef(batterySaver);
  batterySaverRef.current = batterySaver;

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const activeRef = useRef(false);
  const lastForceKeyRef = useRef(forcePingKey);

  const scheduleNext = useCallback((nextDelayMs: number, sampleFn: () => void) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!activeRef.current) return;
    timerRef.current = window.setTimeout(sampleFn, nextDelayMs);
  }, []);

  const sampleOnce = useCallback(
    (isForcedPing = false) => {
      if (!activeRef.current && !isForcedPing) return;
      if (!('geolocation' in navigator)) {
        setStatus('ERROR');
        setError('Geolocation is not supported on this device.');
        return;
      }
      if (inFlightRef.current && !isForcedPing) return;
      inFlightRef.current = true;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          inFlightRef.current = false;
          const pt: GeoPoint = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 50),
            timestamp: Date.now(),
          };

          const check = evaluateBoundaryClient(pt, boundaryRef.current);
          setLocation(pt);
          setInsideBoundary(check.inside);
          setSignedDistanceMeters(check.signedDistanceMeters);
          setError(null);
          setStatus(pt.accuracy > 35 ? 'WEAK' : 'LOCKED');

          onFixRef.current(pt, isForcedPing);

          if (activeRef.current) {
            const nearOrOutside = !check.inside || check.signedDistanceMeters < 25;
            const nextMs = nearOrOutside ? 2000 : batterySaverRef.current ? 12_000 : 6000;
            scheduleNext(nextMs, () => sampleOnce(false));
          }
        },
        (err) => {
          inFlightRef.current = false;
          setStatus('ERROR');
          if (err.code === err.PERMISSION_DENIED) {
            setError('Location permission denied. Enable GPS for boundary tracking.');
          } else if (err.code === err.TIMEOUT) {
            setError('GPS lock timed out — move outdoors for clearer sky view.');
          } else {
            setError('Unable to read GPS location.');
          }

          if (activeRef.current) {
            scheduleNext(8000, () => sampleOnce(false));
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: isForcedPing ? 0 : 2500,
          timeout: 10_000,
        }
      );
    },
    [scheduleNext]
  );

  useEffect(() => {
    activeRef.current = enabled;
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStatus('IDLE');
      return;
    }

    setStatus('LOCATING');
    sampleOnce(false);

    return () => {
      activeRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, sampleOnce]);

  useEffect(() => {
    if (forcePingKey !== lastForceKeyRef.current) {
      lastForceKeyRef.current = forcePingKey;
      if (enabled) {
        sampleOnce(true);
      }
    }
  }, [forcePingKey, enabled, sampleOnce]);

  return {
    location,
    insideBoundary,
    signedDistanceMeters,
    status,
    error,
    triggerFreshFix: sampleOnce,
  };
}
