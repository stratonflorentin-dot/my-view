/**
 * Geo-fence evaluation: circle, rectangle and polygon containment.
 * Used by the contributor scanner (client mirror) and re-validated
 * server-side on every capture.
 */

export type Pt = { lat: number; lng: number };

export type Fence =
  | { type: "circle"; centerLat: number; centerLng: number; radiusM: number }
  | { type: "rectangle"; bbox: [number, number, number, number] } // minLng,minLat,maxLng,maxLat
  | { type: "polygon"; ring: [number, number][] }; // [[lng,lat], ...]

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dp = toR(lat2 - lat1);
  const dl = toR(lng2 - lng1);
  const s =
    Math.sin(dp / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ray-casting point-in-polygon on (lng, lat) ring coordinates. */
export function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function inFence(pt: Pt, fence: Fence): boolean {
  switch (fence.type) {
    case "circle":
      return haversineM(pt.lat, pt.lng, fence.centerLat, fence.centerLng) <= fence.radiusM;
    case "rectangle": {
      const [minLng, minLat, maxLng, maxLat] = fence.bbox;
      return (
        pt.lat >= Math.min(minLat, maxLat) &&
        pt.lat <= Math.max(minLat, maxLat) &&
        pt.lng >= Math.min(minLng, maxLng) &&
        pt.lng <= Math.max(minLng, maxLng)
      );
    }
    case "polygon":
      return pointInRing(pt.lat, pt.lng, fence.ring);
  }
}

/** Parse a contributor link's stored fence into an evaluatable Fence. */
export function fenceFromLink(link: {
  fenceType: "circle" | "polygon" | "rectangle";
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number;
  polygon: unknown;
  scope: string;
}): Fence | null {
  if (link.scope === "global") return null;
  switch (link.fenceType) {
    case "circle":
      if (link.centerLat == null || link.centerLng == null) return null;
      return {
        type: "circle",
        centerLat: link.centerLat,
        centerLng: link.centerLng,
        radiusM: link.radiusM,
      };
    case "rectangle": {
      const b = link.polygon as [number, number, number, number] | null;
      if (!Array.isArray(b) || b.length !== 4) return null;
      return { type: "rectangle", bbox: b };
    }
    case "polygon": {
      const fc = link.polygon as
        | { coordinates?: number[][][] }
        | [number, number][]
        | null;
      if (!fc) return null;
      const ring = Array.isArray(fc)
        ? fc
        : ((fc.coordinates?.[0] ?? null) as [number, number][] | null);
      if (!ring || ring.length < 3) return null;
      return { type: "polygon", ring };
    }
  }
}

export const OUTSIDE_FENCE_MESSAGE = "You are outside the permitted scanning area.";
