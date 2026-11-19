import type { Boundary, LatLng } from './shared/types.js';

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ray-casting point-in-polygon check. Works accurately for city-block scale polygons.
 */
export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;

    const xi = pi.lng;
    const yi = pi.lat;
    const xj = pj.lng;
    const yj = pj.lat;

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Shortest distance in meters from point P to segment AB using local equirectangular projection.
 */
function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos(toRad(p.lat));
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosLat;

  const ax = (a.lng - p.lng) * mPerDegLng;
  const ay = (a.lat - p.lat) * mPerDegLat;
  const bx = (b.lng - p.lng) * mPerDegLng;
  const by = (b.lat - p.lat) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(ax, ay);
  }
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(projX, projY);
}

export interface BoundaryCheckResult {
  inside: boolean;
  /** Positive when inside (distance to nearest border), negative when outside. */
  signedDistanceMeters: number;
}

export function evaluateBoundary(point: LatLng, boundary: Boundary): BoundaryCheckResult {
  if (boundary.type === 'NONE') {
    return { inside: true, signedDistanceMeters: Number.POSITIVE_INFINITY };
  }

  if (boundary.type === 'CIRCLE') {
    const dist = haversineMeters(point, boundary.center);
    const margin = boundary.radiusMeters - dist;
    return { inside: margin >= 0, signedDistanceMeters: margin };
  }

  if (boundary.points.length < 3) {
    return { inside: true, signedDistanceMeters: Number.POSITIVE_INFINITY };
  }

  const inside = isPointInPolygon(point, boundary.points);
  let minEdgeDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < boundary.points.length; i++) {
    const a = boundary.points[i];
    const b = boundary.points[(i + 1) % boundary.points.length];
    if (!a || !b) continue;
    const d = distanceToSegmentMeters(point, a, b);
    if (d < minEdgeDist) minEdgeDist = d;
  }

  return {
    inside,
    signedDistanceMeters: inside ? minEdgeDist : -minEdgeDist,
  };
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
