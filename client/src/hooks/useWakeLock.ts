import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

/**
 * Keeps mobile screen awake during active rounds so iOS/Android don't throttle GPS.
 * Automatically releases when disabled (e.g. Battery Saver ON or in Lobby/Summary).
 */
export function useWakeLock(active: boolean): { isAwake: boolean; supported: boolean } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [isAwake, setIsAwake] = useState(false);

  useEffect(() => {
    if (!active || !supported) {
      setIsAwake(false);
      return;
    }

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const requestLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (!nav.wakeLock) return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
        setIsAwake(true);
      } catch {
        setIsAwake(false);
      }
    };

    void requestLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void requestLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      setIsAwake(false);
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [active, supported]);

  return { isAwake, supported };
}
