/** Geodesy + geometry helpers used by the capture pipeline and the map. */

const R = 6371008.8; // mean Earth radius (m)

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const p1 = deg2rad(lat1);
  const p2 = deg2rad(lat2);
  const dp = deg2rad(lat2 - lat1);
  const dl = deg2rad(lng2 - lng1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ENU (east-north-up) local projection around an origin, in meters. */
export function toLocalM(
  lat: number,
  lng: number,
  oLat: number,
  oLng: number,
): { x: number; y: number } {
  const kx = 111320 * Math.cos(deg2rad(oLat));
  return { x: (lng - oLng) * kx, y: (lat - oLat) * 110574 };
}

export function fromLocalM(
  x: number,
  y: number,
  oLat: number,
  oLng: number,
): { lat: number; lng: number } {
  const kx = 111320 * Math.cos(deg2rad(oLat));
  return { lat: oLat + y / 110574, lng: oLng + x / kx };
}

export type Pt = { lat: number; lng: number };

/** Andrew's monotone chain convex hull in local ENU space. */
export function convexHull(points: Pt[]): Pt[] {
  const o = points[0];
  const local = points
    .map((p) => toLocalM(p.lat, p.lng, o.lat, o.lng))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (
    o2: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o2.x) * (b.y - o2.y) - (a.y - o2.y) * (b.x - o2.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of local) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = local.length - 1; i >= 0; i--) {
    const p = local[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.length < 3
    ? points
    : hull.map((p) => fromLocalM(p.x, p.y, o.lat, o.lng));
}

/** Shrink a polygon toward its centroid by factor f (0..1). */
export function shrinkTowardCentroid(
  poly: Pt[],
  f: number,
): Pt[] {
  const c = polygonCentroid(poly);
  return poly.map((p) => ({
    lat: c.lat + (p.lat - c.lat) * (1 - f),
    lng: c.lng + (p.lng - c.lng) * (1 - f),
  }));
}

export function polygonCentroid(poly: Pt[]): Pt {
  if (!poly.length) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

/** Regular n-gon footprint (single-view estimate fallback). */
export function regularPolygon(
  center: Pt,
  radiusM: number,
  sides: number,
  bearingOffsetDeg = 0,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const a = deg2rad(bearingOffsetDeg + (360 / sides) * i);
    out.push(
      fromLocalM(
        Math.sin(a) * radiusM,
        Math.cos(a) * radiusM,
        center.lat,
        center.lng,
      ),
    );
  }
  return out;
}

/** Compass octant for a heading: 0=front(N), 1=NE, 2=front-right(E)… */
export const ARCS = [
  "Front",
  "Front-right",
  "Right",
  "Rear-right",
  "Rear",
  "Rear-left",
  "Left",
  "Front-left",
] as const;

export function arcOf(heading: number | null): number | null {
  if (heading == null || Number.isNaN(heading)) return null;
  return Math.floor(norm360(heading) / 45) % 8;
}

/** Fraction of the 8 compass arcs covered by the given headings. */
export function arcCoverage(headings: (number | null)[]): {
  distinctArcs: number;
  fraction: number;
  covered: number[];
} {
  const set = new Set<number>();
  for (const h of headings) {
    const a = arcOf(h);
    if (a != null) set.add(a);
  }
  const covered = [...set].sort((a, b) => a - b);
  return {
    distinctArcs: set.size,
    fraction: set.size / 8,
    covered,
  };
}

/** GeoJSON polygon from a list of points (rings are closed). */
export function toGeoJSONPolygon(points: Pt[]) {
  const ring = [
    ...points.map((p) => [p.lng, p.lat] as [number, number]),
    [points[0].lng, points[0].lat] as [number, number],
  ];
  return { type: "Polygon" as const, coordinates: [ring] };
}

/** Approximate polygon area in m² (shoelace in local ENU). */
export function polygonAreaM2(poly: Pt[]): number {
  if (poly.length < 3) return 0;
  const o = poly[0];
  const l = poly.map((p) => toLocalM(p.lat, p.lng, o.lat, o.lng));
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i];
    const b = l[(i + 1) % l.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/** Simple DBSCAN-lite cluster assignment around a candidate point. */
export function nearestCenter(
  p: Pt,
  centers: Pt[],
  maxM: number,
): number | null {
  let best: number | null = null;
  let bestD = maxM;
  centers.forEach((c, i) => {
    const d = haversineM(p.lat, p.lng, c.lat, c.lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function formatCoord(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
