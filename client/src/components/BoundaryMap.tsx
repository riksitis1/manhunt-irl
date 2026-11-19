import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Maximize2, RotateCcw, Square, Trash2 } from 'lucide-react';
import type {
  Boundary,
  GeoPoint,
  GpsPingItem,
  HunterRadarSpot,
  LatLng,
  PublicPlayer,
} from '@shared/types';
import { formatTimeAgo, haversineMeters } from '../lib/geo';

interface BoundaryMapProps {
  boundary: Boundary;
  editable?: boolean;
  onChangeBoundary?: (boundary: Boundary) => void;
  myLocation?: GeoPoint | null;
  isOutOfBounds?: boolean;
  hunters?: PublicPlayer[];
  gpsPings?: GpsPingItem[];
  radarSpots?: HunterRadarSpot[];
  nowMs?: number;
  heightClass?: string;
}

const DEFAULT_CENTER: [number, number] = [40.7128, -74.006];

function escapeHtml(raw: string): string {
  return raw.replace(/[<>&"']/g, '');
}

function createLabelIcon(label: string, colorClass: string, sub?: string): L.DivIcon {
  const safeLabel = escapeHtml(label);
  const safeSub = sub ? escapeHtml(sub) : '';
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
      <div style="padding:3px 7px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,0.22);box-shadow:0 4px 12px rgba(0,0,0,0.65);" class="${colorClass}">
        ${safeLabel}${safeSub ? `<span style="opacity:0.8;font-weight:500;margin-left:4px;">${safeSub}</span>` : ''}
      </div>
      <div style="width:10px;height:10px;border-radius:9999px;margin-top:3px;border:2px solid #fff;" class="${colorClass}"></div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function createCornerHandleIcon(index: number): L.DivIcon {
  const bg = index === 0 ? '#f59e0b' : '#10b981';
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;color:#06080d;font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.65);cursor:grab;touch-action:none;">${index + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function createCenterHandleIcon(): L.DivIcon {
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:#10b981;border:2.5px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.65);cursor:grab;touch-action:none;">
      <div style="width:8px;height:8px;border-radius:9999px;background:#06080d;"></div>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function buildBoxAround(center: LatLng, halfSizeMeters = 75): LatLng[] {
  const dLat = halfSizeMeters / 111_320;
  const dLng = halfSizeMeters / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return [
    { lat: center.lat + dLat, lng: center.lng - dLng },
    { lat: center.lat + dLat, lng: center.lng + dLng },
    { lat: center.lat - dLat, lng: center.lng + dLng },
    { lat: center.lat - dLat, lng: center.lng - dLng },
  ];
}

export function BoundaryMap({
  boundary,
  editable = false,
  onChangeBoundary,
  myLocation = null,
  isOutOfBounds = false,
  hunters = [],
  gpsPings = [],
  radarSpots = [],
  nowMs = Date.now(),
  heightClass = 'h-72',
}: BoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const liveLayerRef = useRef<L.LayerGroup | null>(null);
  const didAutoCenterRef = useRef(false);
  const ignoreMapClickUntilRef = useRef(0);

  const [drawTool, setDrawTool] = useState<'POLYGON' | 'CIRCLE'>(
    boundary.type === 'CIRCLE' ? 'CIRCLE' : 'POLYGON'
  );
  const [draftPoints, setDraftPoints] = useState<LatLng[]>(
    boundary.type === 'POLYGON' ? boundary.points : []
  );
  const [circleRadius, setCircleRadius] = useState<number>(
    boundary.type === 'CIRCLE' ? boundary.radiusMeters : 160
  );
  const [locating, setLocating] = useState(false);

  // Keep local editor state in sync when boundary changes externally
  useEffect(() => {
    if (boundary.type === 'POLYGON') {
      setDraftPoints(boundary.points);
    } else if (boundary.type === 'CIRCLE') {
      setCircleRadius(boundary.radiusMeters);
    } else if (!editable) {
      setDraftPoints([]);
    }
  }, [boundary, editable]);

  const drawToolRef = useRef(drawTool);
  drawToolRef.current = drawTool;
  const circleRadiusRef = useRef(circleRadius);
  circleRadiusRef.current = circleRadius;
  const onChangeRef = useRef(onChangeBoundary);
  onChangeRef.current = onChangeBoundary;

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: 16,
      zoomControl: false,
      doubleClickZoom: !editable,
      preferCanvas: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    boundaryLayerRef.current = L.layerGroup().addTo(map);
    liveLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (editable) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (Date.now() < ignoreMapClickUntilRef.current) return;
        const pt: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng };

        if (drawToolRef.current === 'CIRCLE') {
          onChangeRef.current?.({
            type: 'CIRCLE',
            center: pt,
            radiusMeters: circleRadiusRef.current,
          });
        } else {
          setDraftPoints((prev) => {
            // Prevent accidental double-tap duplicates within 3 meters
            const last = prev[prev.length - 1];
            if (last && haversineMeters(last, pt) < 3) {
              return prev;
            }
            const next = [...prev, pt].slice(0, 30);
            if (next.length >= 3) {
              onChangeRef.current?.({ type: 'POLYGON', points: next });
            }
            return next;
          });
        }
      });
    }

    // ResizeObserver prevents blank/grey tile glitches on tab switch or orientation change
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(el);

    const initTimer = window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 180);

    return () => {
      window.clearTimeout(initTimer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      boundaryLayerRef.current = null;
      liveLayerRef.current = null;
    };
  }, [editable]);

  const fitToBoundary = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (boundary.type === 'POLYGON' && boundary.points.length >= 3) {
      const bounds = L.latLngBounds(boundary.points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 18 });
    } else if (boundary.type === 'CIRCLE') {
      const circle = L.circle([boundary.center.lat, boundary.center.lng], {
        radius: boundary.radiusMeters,
      });
      map.fitBounds(circle.getBounds(), { padding: [32, 32], maxZoom: 18 });
    } else if (myLocation) {
      map.setView([myLocation.lat, myLocation.lng], 17);
    }
  }, [boundary, myLocation]);

  // Auto-center once on boundary or user GPS
  useEffect(() => {
    const map = mapRef.current;
    if (!map || didAutoCenterRef.current) return;

    if (boundary.type === 'POLYGON' && boundary.points.length >= 3) {
      didAutoCenterRef.current = true;
      fitToBoundary();
    } else if (boundary.type === 'CIRCLE') {
      didAutoCenterRef.current = true;
      fitToBoundary();
    } else if (myLocation) {
      didAutoCenterRef.current = true;
      map.setView([myLocation.lat, myLocation.lng], 17);
    }
  }, [boundary, myLocation, fitToBoundary]);

  // Render boundary shapes & draggable corner/center handles
  useEffect(() => {
    const layer = boundaryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const strokeColor = isOutOfBounds ? '#ef4444' : '#10b981';
    const fillColor = isOutOfBounds ? '#ef4444' : '#10b981';

    if (boundary.type === 'CIRCLE' && (!editable || drawTool === 'CIRCLE')) {
      const circleShape = L.circle([boundary.center.lat, boundary.center.lng], {
        radius: boundary.radiusMeters,
        color: strokeColor,
        weight: 2.5,
        fillColor,
        fillOpacity: isOutOfBounds ? 0.22 : 0.13,
        dashArray: isOutOfBounds ? '6 6' : undefined,
      }).addTo(layer);

      if (editable) {
        const handle = L.marker([boundary.center.lat, boundary.center.lng], {
          icon: createCenterHandleIcon(),
          draggable: true,
        }).addTo(layer);

        handle.on('dragstart', () => {
          ignoreMapClickUntilRef.current = Date.now() + 10_000;
        });
        handle.on('drag', () => {
          const pos = handle.getLatLng();
          circleShape.setLatLng(pos);
        });
        handle.on('dragend', () => {
          ignoreMapClickUntilRef.current = Date.now() + 300;
          const pos = handle.getLatLng();
          onChangeRef.current?.({
            type: 'CIRCLE',
            center: { lat: pos.lat, lng: pos.lng },
            radiusMeters: circleRadiusRef.current,
          });
        });
      }
      return;
    }

    const pts =
      editable && drawTool === 'POLYGON'
        ? draftPoints
        : boundary.type === 'POLYGON'
          ? boundary.points
          : [];

    let polyShape: L.Polygon | null = null;
    let lineShape: L.Polyline | null = null;

    if (pts.length >= 3) {
      polyShape = L.polygon(
        pts.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: strokeColor,
          weight: 2.5,
          fillColor,
          fillOpacity: isOutOfBounds ? 0.22 : 0.13,
          dashArray: isOutOfBounds ? '6 6' : undefined,
        }
      ).addTo(layer);
    } else if (pts.length === 2) {
      lineShape = L.polyline(
        pts.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#10b981', weight: 2, dashArray: '5 5' }
      ).addTo(layer);
    }

    if (editable && drawTool === 'POLYGON') {
      const livePoints = pts.map((p) => ({ ...p }));

      livePoints.forEach((p, idx) => {
        const marker = L.marker([p.lat, p.lng], {
          icon: createCornerHandleIcon(idx),
          draggable: true,
        }).addTo(layer);

        marker.on('dragstart', () => {
          ignoreMapClickUntilRef.current = Date.now() + 10_000;
        });

        marker.on('drag', () => {
          const pos = marker.getLatLng();
          livePoints[idx] = { lat: pos.lat, lng: pos.lng };
          const coords = livePoints.map((pt) => [pt.lat, pt.lng] as [number, number]);
          if (polyShape) polyShape.setLatLngs(coords);
          if (lineShape) lineShape.setLatLngs(coords);
        });

        marker.on('dragend', () => {
          ignoreMapClickUntilRef.current = Date.now() + 300;
          const pos = marker.getLatLng();
          const updated = livePoints.map((pt, i) =>
            i === idx ? { lat: pos.lat, lng: pos.lng } : pt
          );
          setDraftPoints(updated);
          if (updated.length >= 3) {
            onChangeRef.current?.({ type: 'POLYGON', points: updated });
          }
        });
      });
    }
  }, [boundary, draftPoints, drawTool, editable, isOutOfBounds]);

  // Render live GPS dots, hunter teammates, runner GPS pings, and secret hunter radar spots
  useEffect(() => {
    const layer = liveLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Own location
    if (myLocation) {
      L.circle([myLocation.lat, myLocation.lng], {
        radius: Math.min(myLocation.accuracy, 80),
        color: '#38bdf8',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.14,
      }).addTo(layer);

      L.circleMarker([myLocation.lat, myLocation.lng], {
        radius: 7,
        color: '#ffffff',
        weight: 2.5,
        fillColor: '#0ea5e9',
        fillOpacity: 1,
      }).addTo(layer);
    }

    // Hunter teammates (visible to hunters & spectators only)
    for (const h of hunters) {
      if (!h.hunterLocation) continue;
      L.marker([h.hunterLocation.lat, h.hunterLocation.lng], {
        icon: createLabelIcon(h.name, 'bg-amber-500 text-slate-950'),
      }).addTo(layer);
    }

    // Latest GPS ping per runner
    const latestByRunner = new Map<string, GpsPingItem>();
    for (const ping of gpsPings) {
      if (!latestByRunner.has(ping.playerId)) {
        latestByRunner.set(ping.playerId, ping);
      }
    }

    for (const ping of latestByRunner.values()) {
      L.circle([ping.lat, ping.lng], {
        radius: Math.max(12, Math.min(ping.accuracy, 75)),
        color: '#ef4444',
        weight: 1.5,
        fillColor: '#ef4444',
        fillOpacity: 0.18,
      }).addTo(layer);

      L.marker([ping.lat, ping.lng], {
        icon: createLabelIcon(
          ping.playerName,
          'bg-red-600 text-white',
          formatTimeAgo(ping.createdAt, nowMs)
        ),
      }).addTo(layer);
    }

    // Private 1-time Secret Hunter Radar spots (ONLY shown to the runner who redeemed the token)
    for (const spot of radarSpots) {
      L.circle([spot.lat, spot.lng], {
        radius: Math.max(15, Math.min(spot.accuracy, 75)),
        color: '#a855f7',
        weight: 2,
        dashArray: '4 4',
        fillColor: '#a855f7',
        fillOpacity: 0.2,
      }).addTo(layer);

      L.marker([spot.lat, spot.lng], {
        icon: createLabelIcon(
          `Hunter: ${spot.hunterName}`,
          'bg-violet-600 text-white',
          formatTimeAgo(spot.recordedAt, nowMs)
        ),
      }).addTo(layer);
    }
  }, [myLocation, hunters, gpsPings, radarSpots, nowMs]);

  const handleLocateMe = () => {
    const map = mapRef.current;
    if (!map) return;
    if (myLocation) {
      map.setView([myLocation.lat, myLocation.lng], 17);
      return;
    }
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setView([pt.lat, pt.lng], 17);
        didAutoCenterRef.current = true;
        if (editable && drawTool === 'CIRCLE' && boundary.type === 'NONE') {
          onChangeBoundary?.({
            type: 'CIRCLE',
            center: pt,
            radiusMeters: circleRadius,
          });
        }
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleDropBlockBox = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const box = buildBoxAround({ lat: c.lat, lng: c.lng }, 75);
    setDrawTool('POLYGON');
    setDraftPoints(box);
    onChangeBoundary?.({ type: 'POLYGON', points: box });
  };

  const handleSwitchTool = (tool: 'POLYGON' | 'CIRCLE') => {
    setDrawTool(tool);
    if (tool === 'CIRCLE') {
      const map = mapRef.current;
      if (boundary.type !== 'CIRCLE' && map) {
        const c = map.getCenter();
        onChangeBoundary?.({
          type: 'CIRCLE',
          center: { lat: c.lat, lng: c.lng },
          radiusMeters: circleRadius,
        });
      }
    } else if (boundary.type === 'CIRCLE') {
      // Convert cleanly into a 4-corner draggable box around the same center
      const box = buildBoxAround(boundary.center, Math.min(250, Math.round(boundary.radiusMeters * 0.8)));
      setDraftPoints(box);
      onChangeBoundary?.({ type: 'POLYGON', points: box });
    }
  };

  const handleUndoPoint = () => {
    setDraftPoints((prev) => {
      const next = prev.slice(0, -1);
      if (next.length >= 3) {
        onChangeBoundary?.({ type: 'POLYGON', points: next });
      } else {
        onChangeBoundary?.({ type: 'NONE' });
      }
      return next;
    });
  };

  const handleClear = () => {
    setDraftPoints([]);
    onChangeBoundary?.({ type: 'NONE' });
  };

  const handleRadiusChange = (nextRadius: number) => {
    setCircleRadius(nextRadius);
    if (boundary.type === 'CIRCLE') {
      onChangeBoundary?.({
        type: 'CIRCLE',
        center: boundary.center,
        radiusMeters: nextRadius,
      });
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-borderSubtle bg-surface">
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borderSubtle bg-surfaceElevated/60 px-3 py-2">
          <div className="inline-flex rounded-lg border border-borderSubtle bg-obsidian p-0.5">
            <button
              type="button"
              onClick={() => handleSwitchTool('POLYGON')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                drawTool === 'POLYGON'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Block Border
            </button>
            <button
              type="button"
              onClick={() => handleSwitchTool('CIRCLE')}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                drawTool === 'CIRCLE'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Circle
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {drawTool === 'POLYGON' && (
              <button
                type="button"
                onClick={handleDropBlockBox}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-300 active:scale-95"
                title="Drop a 4-corner draggable box on screen"
              >
                <Square className="h-3 w-3" />
                Drop Box
              </button>
            )}
            {drawTool === 'POLYGON' && draftPoints.length > 0 && (
              <button
                type="button"
                onClick={handleUndoPoint}
                className="inline-flex items-center gap-1 rounded-lg border border-borderSubtle bg-obsidian px-2 py-1 text-xs font-semibold text-slate-300 active:scale-95"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Undo
              </button>
            )}
            {(boundary.type !== 'NONE' || draftPoints.length > 0) && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-400 active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {editable && drawTool === 'CIRCLE' && (
        <div className="flex items-center gap-3 border-b border-borderSubtle/70 bg-obsidian/70 px-3 py-2">
          <span className="text-xs font-semibold text-slate-400">Radius</span>
          <input
            type="range"
            min={50}
            max={600}
            step={10}
            value={circleRadius}
            onChange={(e) => handleRadiusChange(Number(e.target.value))}
            className="h-1.5 flex-1 accent-emerald-500"
          />
          <span className="w-12 text-right font-mono text-xs font-bold text-emerald-400">
            {circleRadius}m
          </span>
        </div>
      )}

      <div className={`relative w-full ${heightClass}`}>
        <div ref={containerRef} className="h-full w-full" />

        {/* Map action pills */}
        <div className="pointer-events-auto absolute right-2.5 top-2.5 z-[400] flex flex-col gap-2">
          <button
            type="button"
            onClick={handleLocateMe}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-borderSubtle bg-obsidian/90 text-slate-100 shadow-lg backdrop-blur active:scale-95"
            title="Center on my GPS"
          >
            <Crosshair className={`h-4 w-4 ${locating ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
          {boundary.type !== 'NONE' && (
            <button
              type="button"
              onClick={fitToBoundary}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-borderSubtle bg-obsidian/90 text-slate-100 shadow-lg backdrop-blur active:scale-95"
              title="Fit play boundary"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {editable && (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-14 z-[400]">
            <div className="inline-block rounded-lg border border-borderSubtle bg-obsidian/90 px-2.5 py-1 text-[11px] font-medium text-slate-300 backdrop-blur">
              {drawTool === 'POLYGON'
                ? draftPoints.length < 3
                  ? `Tap map corners (${draftPoints.length}/3+) or tap "Drop Box" to drag 4 corners`
                  : `Drag any numbered corner to adjust (${draftPoints.length} pts)`
                : boundary.type === 'CIRCLE'
                  ? `Drag green center pin or slide radius (${boundary.radiusMeters}m)`
                  : 'Tap map or My GPS button to place circle'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
