import type { Map as MLMap } from "maplibre-gl";

/**
 * Reusable building-framing camera system.
 *
 * Given a building's real geographic footprint and height, computes the
 * camera pose that fits the ENTIRE structure (base to roof) inside the
 * visible viewport with a comfortable margin — no hard-coded zoom values.
 *
 * Math model (angles in radians):
 *   δ    = view-ray depression below the horizon (90° − pitch)
 *   α    = vertical half-FOV (MapLibre default 36.87° full → 0.3217 rad)
 *   h    = camera height, d = horizontal camera→target distance
 *   h = d·tanδ, slant range s = d/cosδ
 *
 * Fit constraints (all must hold, d minimized):
 *   top   — roof visible:        d ≥ H / (tanδ − tan(δ − αₑ))
 *   near  — base in frame:       d ≥ R / (1 − tanδ / tan(δ + αₑ))
 *   far   — far side in frame:   d ≥ R / (tanδ / tan(δ − αₑ) − 1)
 *   side  — width in frame:      d ≥ R / tan(αₕ)
 * where αₑ is the FOV half-angle shrunk by the requested margin and αₕ the
 * horizontal equivalent for the visible aspect ratio.
 *
 * Zoom is then derived from the slant range and the full canvas height:
 *   mpp = 2·s·tan(FOV/2) / canvasHeight
 *   zoom = log2(156543.03392·cos(lat) / mpp)
 */

export type FrameBounds = [[number, number], [number, number]]; // [[w, s], [e, n]] lng/lat

export type FrameInput = {
  bounds: FrameBounds;
  center: [number, number]; // [lng, lat]
  heightM: number;
};

export type FramePadding = { top: number; bottom: number; left: number; right: number };

const FOV_DEFAULT = 0.6435; // rad — MapLibre default vertical FOV (~36.87°)
const PITCH_DEG = 55; // professional three-quarter view
const BEARING_DEG = 30; // front + side visible
const MIN_DISTANCE_M = 25;
/** Hard zoom cap. Raster basemaps are true-resolution only to ~z18;
 *  framing beyond that renders an unusable over-zoomed blur. The 3D
 *  extrusion stays crisp (vector), but the view must stay readable. */
const MAX_ZOOM = 19;

/** Meters-per-pixel at zoom z and latitude lat (Web-Mercator). */
function mppForZoom(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Ground radius (m) of a lng/lat bounds box, equirectangular. */
export function boundsRadiusM(bounds: FrameBounds): number {
  const [[w, s], [e, n]] = bounds;
  const lat = (s + n) / 2;
  const wM = Math.max((e - w) * 111320 * Math.cos((lat * Math.PI) / 180), 0);
  const dM = Math.max((n - s) * 110574, 0);
  return Math.hypot(wM, dM) / 2;
}

/** Bounds of a point "building" (no footprint yet). Radius keeps enough
 *  ground context that the view stays readable at the zoom cap. */
export function pointBounds(lng: number, lat: number, radiusM = 18): FrameBounds {
  const dx = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const dy = radiusM / 110574;
  return [
    [lng - dx, lat - dy],
    [lng + dx, lat + dy],
  ];
}

/** Bounds of a GeoJSON Polygon footprint (outer ring). */
export function polygonBounds(
  polygon: { type: "Polygon"; coordinates: number[][][] } | null | undefined,
): FrameBounds | null {
  const ring = polygon?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Effective model height: explicit height → floors estimate → sane default. */
export function effectiveHeightM(heightM: number | null | undefined, floors?: number | null): number {
  if (heightM != null && heightM > 0) return heightM;
  if (floors != null && floors > 0) return floors * 3.2;
  return 10;
}

export type FramedCamera = {
  zoom: number;
  pitch: number;
  bearing: number;
  center: [number, number];
  distanceM: number;
};

/**
 * Compute (without moving) the camera pose that frames `input`.
 * `padding` describes UI overlaying the map (panel, bars) — the building is
 * fitted into the REMAINING viewport.
 */
export function computeBuildingCamera(
  map: Pick<MLMap, "getContainer">,
  input: FrameInput,
  opts: { padding?: FramePadding | null; margin?: number } = {},
): FramedCamera {
  const lat = input.center[1];
  const R = Math.max(boundsRadiusM(input.bounds), 5);
  const H = Math.max(input.heightM, 5);

  const canvas = map.getContainer();
  const canvasW = canvas.clientWidth || 900;
  const canvasH = canvas.clientHeight || 600;
  const p = opts.padding ?? null;
  const visW = Math.max(canvasW - (p?.left ?? 0) - (p?.right ?? 0), 120);
  const visH = Math.max(canvasH - (p?.top ?? 0) - (p?.bottom ?? 0), 120);

  const fov =
    ((map as unknown as { transform?: { fov?: number } }).transform?.fov) ?? FOV_DEFAULT;
  const margin = opts.margin ?? 0.18; // 18% breathing room total
  const aEff = (fov / 2) * Math.max(1 - margin * 2, 0.5);
  const aHEff = Math.atan(Math.tan(aEff) * (visW / visH));

  const pitch = (PITCH_DEG * Math.PI) / 180;
  const delta = Math.PI / 2 - pitch;
  const tD = Math.tan(delta);
  const tHi = Math.tan(Math.min(delta + aEff, Math.PI / 2 - 0.01));
  const tLo = tD - aEff > 0 ? Math.tan(delta - aEff) : 0;

  const dTop = H / Math.max(tD - tLo, 0.02);
  const dNear = R / Math.max(1 - tD / tHi, 0.05);
  const dFar = tLo > 0 ? R / Math.max(tD / tLo - 1, 0.05) : 0;
  const dSide = R / Math.tan(aHEff);

  const d = Math.max(dTop, dNear, dFar, dSide, MIN_DISTANCE_M);
  const slant = d / Math.cos(delta);
  // Floor the ground resolution so the derived zoom never asks the basemap
  // for detail it does not have (over-zoom blur).
  const mpp = Math.max((2 * slant * Math.tan(fov / 2)) / canvasH, 0.3);
  const zoom = Math.min(MAX_ZOOM, Math.max(11, Math.log2(mppForZoom(0, lat) / mpp)));

  return {
    zoom,
    pitch: PITCH_DEG,
    bearing: BEARING_DEG,
    center: input.center,
    distanceM: d,
  };
}

/**
 * Frame a building: set overlay padding (if provided), then animate the
 * camera so the complete structure fits the visible viewport.
 */
export function frameBuilding(
  map: MLMap,
  input: FrameInput,
  opts: { padding?: FramePadding | null; margin?: number; duration?: number } = {},
): FramedCamera {
  const cam = computeBuildingCamera(map, input, opts);
  if (opts.padding !== undefined) {
    map.setPadding(opts.padding ?? { top: 0, bottom: 0, left: 0, right: 0 });
  }
  map.flyTo({
    center: cam.center,
    zoom: cam.zoom,
    pitch: cam.pitch,
    bearing: cam.bearing,
    duration: opts.duration ?? 1200,
    essential: true,
  });
  return cam;
}
