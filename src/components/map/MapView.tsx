"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapControls, type MapMode } from "./MapControls";
import {
  frameBuilding,
  pointBounds,
  polygonBounds,
  type FrameBounds,
  type FrameInput,
  type FramePadding,
} from "./camera";

// MapLibre + Turbopack: the bundler-generated worker URL does not resolve in
// the browser ("Worker failed to load" → blank map). Pin the prebuilt worker
// shipped in /public instead (worker.mjs + its relative shared chunk).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

/**
 * Main 3D map engine — MapLibre GL JS.
 *
 * Basemaps (keyless by default):
 *  - Satellite: Esri World Imagery raster, maxzoom 17 (true captures end
 *    there; deeper zoom over-zooms the last real tile) + transparent
 *    World Boundaries & Places labels → hybrid view.
 *  - Dark streets: CARTO dark raster.
 *  - Terrain: Terrarium DEM (keyless) with exaggeration.
 *
 * Data: viewport-scoped GeoJSON from /api/map/features — only objects in
 * the current bbox are ever requested. Buildings render as real
 * fill-extrusion geometry; estimated vs verified are visually distinct.
 */

export type MapViewHandle = {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  /** Frame the complete building (base → roof) in the visible viewport.
   *  `fallbackCenter` flies there first when geometry isn't cached yet. */
  focusBuilding: (
    id: string,
    heightM: number | null,
    padding?: FramePadding | null,
    fallbackCenter?: [number, number],
  ) => void;
  /** Return to the camera state from before the last focusBuilding. */
  resetView: () => void;
};

type Props = {
  preview?: boolean;
  selectedId?: string | null;
  onSelectBuilding?: (id: string | null) => void;
  onMapReady?: () => void;
};

const ESRI_SAT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const CARTO_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const CARTO_STREETS =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TERRARIUM = "https://elevation-tile-prod.s3.amazonaws.com/{z}/{x}/{y}.png";

/* MapTiler upgrade path (NEXT_PUBLIC_MAPTILER_API_KEY). When the key is
 * present AND answers a probe request, keyed tiles lead:
 *  - satellite-v2 (true imagery to z20)
 *  - streets-v2-dark (dark vector-style raster)
 * If the key is missing or rejected, the map silently falls back to the
 * keyless Esri / CARTO sources — the map never renders blank tiles. */
const TILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";
const TILER_SAT = `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${TILER_KEY}`;
const TILER_DARK = `https://api.maptiler.com/maps/streets-v2-dark/256/{z}/{x}/{y}.png?key=${TILER_KEY}`;

async function mapTilerUsable(kind: "sat" | "dark"): Promise<boolean> {
  if (!TILER_KEY) return false;
  const url =
    kind === "sat"
      ? `https://api.maptiler.com/tiles/satellite-v2/0/0/0.jpg?key=${TILER_KEY}`
      : `https://api.maptiler.com/maps/streets-v2-dark/256/0/0/0.png?key=${TILER_KEY}`;
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

/** Great-circle distance between two points, in metres. */
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Planar area of a polygon on the sphere (equirectangular approximation),
 *  in m² — accurate enough for parcel-scale shapes. */
function ringArea(pts: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    total +=
      ((x2 - x1) * Math.PI) / 180 *
      111320 *
      ((y1 + y2) * Math.PI) / 360 *
      111320;
  }
  return Math.abs(total / 2);
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}

function fmtArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`;
}

/** Live readout for the measure tool: path length, plus enclosed area from 3 points. */
function measureReadout(pts: [number, number][]): string {
  let dist = 0;
  for (let i = 0; i < pts.length - 1; i++) dist += haversine(pts[i], pts[i + 1]);
  if (pts.length < 3) return `Length ${fmtDist(dist)}`;
  // Closing the ring does not add to the path length shown.
  const area = ringArea([...pts, pts[0]]);
  return `Length ${fmtDist(dist)} · Area ${fmtArea(area)}`;
}

const CENTER: [number, number] = [39.2083, -6.7924]; // Dar es Salaam
const PREVIEW_CENTER: [number, number] = [39.27, -1.95]; // Lake Victoria

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Approximate circle of `accuracyM` radius around a point (equirectangular —
 *  fine at the city scales an accuracy circle spans). */
function accuracyCircle(lng: number, lat: number, accuracyM: number): GeoJSON.FeatureCollection {
  const r = Math.min(Math.max(accuracyM, 8), 20000);
  const dx = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const dy = r / 110574;
  const ring: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([lng + dx * Math.cos(t), lat + dy * Math.sin(t)]);
  }
  ring.push(ring[0]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(
  { preview = false, selectedId = null, onSelectBuilding, onMapReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mode, setMode] = useState<MapMode>("3d");
  const [basemap, setBasemap] = useState<"satellite" | "dark" | "streets">("satellite");
  const [terrain, setTerrain] = useState(false);
  const [layers, setLayers] = useState({
    buildings: true,
    captures: false,
    coverage: true,
    heatmap: false,
    labels: true,
  });
  const [measure, setMeasure] = useState(false);
  const [mpts, setMpts] = useState<[number, number][]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lng: number; lat: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const watchRef = useRef<number | null>(null);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  /** Set once the MapLibre style has fully loaded — every style-mutating
   *  effect must wait for this, or MapLibre throws "Style is not done
   *  loading" and React unmounts the whole tree. */
  const [loaded, setLoaded] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onSelectRef = useRef(onSelectBuilding);
  onSelectRef.current = onSelectBuilding;
  const fetchSeq = useRef(0);
  /** Real footprint bounds per building id, from the last features fetch. */
  const geomCacheRef = useRef(new Map<string, { bounds: FrameBounds; center: [number, number] }>());
  const lastFrameRef = useRef<{ id: string; input: FrameInput; padding: FramePadding | null } | null>(null);
  const prevCameraRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);
  const focusedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    flyTo: (lng, lat, zoom = 17) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1400 });
    },
    focusBuilding: (id, heightM, padding = null, fallbackCenter) => {
      const map = mapRef.current;
      if (!map) return;
      if (!focusedRef.current) {
        const c = map.getCenter();
        prevCameraRef.current = {
          center: [c.lng, c.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
      }
      focusedRef.current = true;
      const cached = geomCacheRef.current.get(id);
      if (!cached) {
        // Geometry not fetched yet — record focus intent; the features
        // loader frames the building once its real footprint arrives.
        // If it is outside the current bbox, fly to the fallback center
        // first so the next viewport fetch includes it.
        lastFrameRef.current = {
          id,
          input: { bounds: pointBounds(0, 0, 0), center: [0, 0], heightM: heightM ?? 10 },
          padding,
        };
        if (fallbackCenter) {
          map.flyTo({
            center: fallbackCenter,
            zoom: Math.max(map.getZoom(), 16.5),
            duration: 1200,
            essential: true,
          });
        }
        return;
      }
      const input: FrameInput = {
        bounds: cached.bounds,
        center: cached.center,
        heightM: heightM ?? 10,
      };
      lastFrameRef.current = { id, input, padding };
      frameBuilding(map, input, { padding });
    },
    resetView: () => {
      const map = mapRef.current;
      if (!map) return;
      focusedRef.current = false;
      lastFrameRef.current = null;
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      const prev = prevCameraRef.current;
      if (prev) {
        map.flyTo({ ...prev, duration: 1000, essential: true });
        prevCameraRef.current = null;
      }
    },
  }));

  // Re-frame the focused building when the usable viewport changes
  // (panel toggle, browser resize, phone rotation, fullscreen).
  useEffect(() => {
    const reframe = () => {
      const map = mapRef.current;
      const lf = lastFrameRef.current;
      if (!map || !lf || !focusedRef.current) return;
      frameBuilding(map, lf.input, { padding: lf.padding, duration: 500 });
    };
    window.addEventListener("resize", reframe);
    document.addEventListener("fullscreenchange", reframe);
    return () => {
      window.removeEventListener("resize", reframe);
      document.removeEventListener("fullscreenchange", reframe);
    };
  }, []);

  // Deselect → drop framing state and restore full-viewport padding.
  useEffect(() => {
    if (selectedId === null) {
      focusedRef.current = false;
      lastFrameRef.current = null;
      mapRef.current?.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
  }, [selectedId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Restore a shared view from the URL hash (#map=zoom/lat/lng).
    let initCenter = preview ? PREVIEW_CENTER : CENTER;
    let initZoom = preview ? 4 : 13;
    if (!preview) {
      const m = /#map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(window.location.hash);
      if (m) {
        initZoom = Math.min(21, Math.max(2, Number(m[1])));
        initCenter = [Number(m[3]), Number(m[2])];
      }
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      // keep the drawing buffer readable (debug tooling + future export)
      canvasContextAttributes: { preserveDrawingBuffer: true },
      center: initCenter,
      zoom: initZoom,
      pitch: preview ? 35 : 62,
      minZoom: 2,
      maxZoom: 21, // framing may derive zoom > 19 for small buildings
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    if (!preview) {
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right",
      );
    }
    map.on("error", () => {
      // Tile-provider hiccups are non-fatal; keep them out of the log.
    });

    map.on("load", async () => {
      // Basemaps — probe the MapTiler key before choosing tile sources.
      const [satKeyed, darkKeyed] = await Promise.all([
        mapTilerUsable("sat"),
        mapTilerUsable("dark"),
      ]);
      map.addSource("sat", {
        type: "raster",
        tiles: [satKeyed ? TILER_SAT : ESRI_SAT],
        tileSize: 256,
        maxzoom: satKeyed ? 20 : 17, // Esri's true capture depth ends at 17
        attribution: satKeyed
          ? "Imagery &copy; MapTiler"
          : "Imagery &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      });
      map.addSource("sat-labels", {
        type: "raster",
        tiles: [ESRI_LABELS],
        tileSize: 256,
        maxzoom: 19,
      });
      map.addSource("dark", {
        type: "raster",
        tiles: [darkKeyed ? TILER_DARK : CARTO_DARK],
        tileSize: 256,
        maxzoom: 19,
        attribution: darkKeyed
          ? "&copy; MapTiler &copy; OpenStreetMap contributors"
          : "&copy; OpenStreetMap contributors &copy; CARTO",
      });
      map.addSource("streets", {
        type: "raster",
        tiles: [CARTO_STREETS],
        tileSize: 256,
        maxzoom: 19,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      });
      map.addLayer({ id: "sat-layer", type: "raster", source: "sat" });
      map.addLayer({ id: "sat-labels-layer", type: "raster", source: "sat-labels" });
      map.addLayer(
        { id: "dark-layer", type: "raster", source: "dark" },
        "sat-layer",
      );
      map.addLayer(
        { id: "streets-layer", type: "raster", source: "streets" },
        "sat-layer",
      );
      map.setLayoutProperty("dark-layer", "visibility", "none");
      map.setLayoutProperty("streets-layer", "visibility", "none");

      // Atmosphere — subtle sky dome for 3D/globe views.
      map.setSky({
        "sky-color": "#0a1220",
        "horizon-color": "#1c2b42",
        "fog-color": "#05080c",
        "sky-horizon-blend": 0.5,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.55,
      });

      // Data sources
      map.addSource("buildings", { type: "geojson", data: EMPTY_FC });
      map.addSource("captures", { type: "geojson", data: EMPTY_FC });
      map.addSource("coverage", { type: "geojson", data: EMPTY_FC });

      const confColor = [
        "interpolate",
        ["linear"],
        ["get", "confidence"],
        0.05,
        "#ef6a5a",
        0.45,
        "#e8c547",
        0.85,
        "#3ecf8e",
      ] as never;

      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: {
          "fill-color": [
            "match",
            ["get", "tier"],
            1,
            "#ef6a5a",
            2,
            "#e8c547",
            3,
            "#9ad048",
            "#3ecf8e",
          ],
          "fill-opacity": 0.16,
        },
      });

      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": [
            "case",
            ["==", ["feature-state", "select"], true],
            "#f0a63c",
            confColor,
          ],
          "fill-opacity": 0.5,
        },
      });
      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "buildings",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-extrusion-color": [
            "case",
            ["==", ["feature-state", "select"], true],
            "#f0a63c",
            confColor,
          ],
          "fill-extrusion-height": ["coalesce", ["get", "heightM"], 14],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "line-color": [
            "case",
            ["==", ["feature-state", "select"], true],
            "#f0a63c",
            ["case", ["==", ["get", "verification"], "verified"], "#3ecf8e", "#e8c547"],
          ],
          "line-width": [
            "case",
            ["==", ["feature-state", "select"], true],
            2.5,
            1,
          ],
        },
      });
      // Buildings without a footprint yet (single capture) render as circles.
      map.addLayer({
        id: "buildings-point",
        type: "circle",
        source: "buildings",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "case",
            ["==", ["feature-state", "select"], true],
            "#f0a63c",
            confColor,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b0e11",
          "circle-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "captures-circles",
        type: "circle",
        source: "captures",
        paint: {
          "circle-radius": 4.5,
          "circle-color": [
            "match",
            ["get", "status"],
            "processed",
            "#3ecf8e",
            "processing",
            "#e8c547",
            "#8b97a5",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0b0e11",
          "circle-opacity": 0.95,
        },
      });

      // Capture-density heatmap — sits under the circles, toggled via Layers.
      map.addLayer(
        {
          id: "captures-heat",
          type: "heatmap",
          source: "captures",
          layout: { visibility: "none" },
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 2.4],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 16, 36],
            "heatmap-opacity": 0.55,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(8,11,14,0)",
              0.2,
              "#2e9fd4",
              0.4,
              "#35c48b",
              0.6,
              "#e8c547",
              0.8,
              "#f0a63c",
              1,
              "#ef6a5a",
            ],
          },
        },
        "captures-circles",
      );

      // Measure tool geometry — one source, line + vertex layers.
      map.addSource("measure", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "measure-line",
        type: "line",
        source: "measure",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#47b4e7",
          "line-width": 2,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addLayer({
        id: "measure-fill",
        type: "fill",
        source: "measure",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#47b4e7", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "measure-vertices",
        type: "circle",
        source: "measure",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#47b4e7",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0b0e11",
        },
      });

      map.on("click", (e: maplibregl.MapMouseEvent) => {
        if (preview) return;
        if (measureRef.current) {
          setMpts((pts) => [...pts, [e.lngLat.lng, e.lngLat.lat]]);
          return;
        }
        const feats = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-3d", "buildings-fill", "buildings-outline", "buildings-point"],
        });
        const id = (feats[0]?.properties as { id?: string } | undefined)?.id;
        onSelectRef.current?.(id ?? null);
      });

      // Double-click a building → select + auto-frame it (suppresses the
      // default double-click zoom only when a building was hit).
      map.on("dblclick", (e: maplibregl.MapMouseEvent) => {
        if (preview || measureRef.current) return;
        const feats = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-3d", "buildings-fill", "buildings-outline", "buildings-point"],
        });
        const id = (feats[0]?.properties as { id?: string } | undefined)?.id;
        if (id) {
          e.preventDefault();
          onSelectRef.current?.(id);
        }
      });

      // Viewport-scoped data loading (debounced moveend).
      let t: ReturnType<typeof setTimeout> | undefined;
      const load = () => {
        const seq = ++fetchSeq.current;
        const b = map.getBounds();
        const bbox = [
          b.getWest(),
          b.getSouth(),
          b.getEast(),
          b.getNorth(),
        ]
          .map((n) => n.toFixed(5))
          .join(",");
        void fetch(`/api/map/features?bbox=${bbox}&kinds=buildings,captures,coverage`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j || seq !== fetchSeq.current) return;
            for (const k of ["buildings", "captures", "coverage"] as const) {
              const src = map.getSource(k) as maplibregl.GeoJSONSource | undefined;
              const fc = (j?.[k] as GeoJSON.FeatureCollection) ?? EMPTY_FC;
              // Attach feature ids so feature-state selection works.
              fc.features.forEach((f, i) => {
                // Numeric feature ids — required for setFeatureState.
                f.id = i;
              });
              src?.setData(fc);

              // Cache real footprint geometry per building for camera framing.
              if (k === "buildings") {
                for (const f of fc.features) {
                  const bid = (f.properties as { id?: string } | undefined)?.id;
                  if (!bid) continue;
                  const geom = f.geometry;
                  let bounds: FrameBounds | null =
                    geom?.type === "Polygon" ? polygonBounds(geom) : null;
                  const props = f.properties as
                    | { centerLng?: number; centerLat?: number }
                    | undefined;
                  let center: [number, number] | null =
                    props?.centerLng != null && props?.centerLat != null
                      ? [props.centerLng, props.centerLat]
                      : geom?.type === "Point"
                        ? [geom.coordinates[0], geom.coordinates[1]]
                        : bounds
                          ? [
                              (bounds[0][0] + bounds[1][0]) / 2,
                              (bounds[0][1] + bounds[1][1]) / 2,
                            ]
                          : null;
                  if (!center) continue;
                  if (!bounds) bounds = pointBounds(center[0], center[1]);
                  const prev = geomCacheRef.current.get(bid);
                  geomCacheRef.current.set(bid, { bounds, center });

                  // Focused building's real footprint just arrived (or
                  // changed) — refine the framing with actual geometry.
                  // `prev === undefined` covers the deep-link case where the
                  // initial focusBuilding was a no-op (no geometry cached yet).
                  if (
                    focusedRef.current &&
                    lastFrameRef.current?.id === bid &&
                    (prev === undefined ||
                      prev.bounds[0][0] !== bounds[0][0] ||
                      prev.bounds[0][1] !== bounds[0][1] ||
                      prev.bounds[1][0] !== bounds[1][0] ||
                      prev.bounds[1][1] !== bounds[1][1])
                  ) {
                    const lf = lastFrameRef.current;
                    lf.input = { bounds, center, heightM: lf.input.heightM };
                    frameBuilding(map, lf.input, { padding: lf.padding, duration: 800 });
                  }
                }
              }
            }
          })
          .catch(() => {});
      };
      map.on("moveend", () => {
        if (!preview) {
          const c = map.getCenter();
          history.replaceState(
            null,
            "",
            `#map=${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`,
          );
        }
        clearTimeout(t);
        t = setTimeout(load, 250);
      });
      load();
      setLoaded(true);
      onMapReady?.();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2D / 3D / Globe (style mutations only after the style has loaded)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const b3d = mode === "3d" ? "visible" : "none";
    map.setLayoutProperty("buildings-fill", "visibility", mode === "3d" ? "none" : "visible");
    map.setLayoutProperty("buildings-3d", "visibility", b3d);
    if (mode === "globe") {
      map.setProjection({ type: "globe" });
      map.easeTo({
        pitch: 0,
        zoom: Math.min(map.getZoom(), 2.6),
        duration: 1200,
      });
    } else {
      map.setProjection({ type: "mercator" });
      map.easeTo({
        pitch: mode === "3d" ? 62 : 0,
        zoom: mode === "3d" ? Math.max(map.getZoom(), 11) : map.getZoom(),
        duration: 900,
      });
    }
  }, [mode, loaded]);

  // Basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const setVis = (id: string, v: "visible" | "none") => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    };
    setVis("sat-layer", basemap === "satellite" ? "visible" : "none");
    setVis("dark-layer", basemap === "dark" ? "visible" : "none");
    setVis("streets-layer", basemap === "streets" ? "visible" : "none");
    // Esri reference labels are tuned for imagery — only shown on satellite.
    setVis("sat-labels-layer", basemap === "satellite" && layers.labels ? "visible" : "none");
  }, [basemap, layers.labels, loaded]);

  // Terrain + hillshade
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (terrain) {
      if (!map.getSource("dem")) {
        map.addSource("dem", {
          type: "raster-dem",
          tiles: [TERRARIUM],
          encoding: "terrarium",
          maxzoom: 14,
          attribution: "Elevation Cesium (Terrarium tiles)",
        });
        map.addLayer(
          {
            id: "hillshade",
            type: "hillshade",
            source: "dem",
            paint: {
              "hillshade-exaggeration": 0.35,
              "hillshade-shadow-color": "#0a0f16",
              "hillshade-highlight-color": "#3a4a5e",
            },
          },
          "coverage-fill", // relief stays under all data layers
        );
      }
      if (map.getLayer("hillshade"))
        map.setLayoutProperty("hillshade", "visibility", "visible");
      map.setTerrain({ source: "dem", exaggeration: 1.4 });
    } else {
      map.setTerrain(null);
      if (map.getLayer("hillshade"))
        map.setLayoutProperty("hillshade", "visibility", "none");
    }
  }, [terrain, loaded]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const show = (on: boolean) => (on ? "visible" : "none");
    if (map.getLayer("coverage-fill"))
      map.setLayoutProperty("coverage-fill", "visibility", show(layers.coverage));
    if (map.getLayer("captures-circles"))
      map.setLayoutProperty("captures-circles", "visibility", show(layers.captures));
    if (map.getLayer("captures-heat"))
      map.setLayoutProperty("captures-heat", "visibility", show(layers.heatmap));
    if (map.getLayer("sat-labels-layer"))
      map.setLayoutProperty(
        "sat-labels-layer",
        "visibility",
        show(basemap === "satellite" && layers.labels),
      );
    const bvis = show(layers.buildings);
    for (const id of ["buildings-fill", "buildings-3d", "buildings-outline", "buildings-point"]) {
      if (map.getLayer(id)) {
        if (id === "buildings-fill") continue; // managed by 2D/3D toggle
        map.setLayoutProperty(id, "visibility", bvis);
      }
    }
  }, [layers, mode, loaded, basemap]);

  // User-location accuracy circle: source+layers once, data on every fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (map.getSource("user-accuracy")) return;
    map.addSource("user-accuracy", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "user-accuracy-fill",
      type: "fill",
      source: "user-accuracy",
      paint: { "fill-color": "#35c48b", "fill-opacity": 0.14 },
    });
    map.addLayer({
      id: "user-accuracy-line",
      type: "line",
      source: "user-accuracy",
      paint: { "line-color": "#35c48b", "line-width": 1, "line-opacity": 0.55 },
    });
  }, [loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !userLoc) return;
    const src = map.getSource("user-accuracy") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(accuracyCircle(userLoc.lng, userLoc.lat, userLoc.accuracy));
  }, [userLoc, loaded]);

  // Auto-clear the location error chip.
  useEffect(() => {
    if (!locError) return;
    const t = setTimeout(() => setLocError(null), 5000);
    return () => clearTimeout(t);
  }, [locError]);

  // Auto-clear the share/notice chip.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // Measure geometry → source, plus Esc to cancel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource("measure") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (mpts.length === 0) {
      src.setData(EMPTY_FC);
      return;
    }
    const ptFeatures: GeoJSON.Feature[] = mpts.map(([lng, lat]) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    }));
    if (mpts.length >= 3) {
      const ring = [...mpts, mpts[0]];
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [ring] },
          },
          ...ptFeatures,
        ],
      });
    } else {
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: mpts },
          },
          ...ptFeatures,
        ],
      });
    }
  }, [mpts, loaded]);

  useEffect(() => {
    if (!measure) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMeasure(false);
        setMpts([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measure]);

  // Reset measure points when the tool is switched off.
  useEffect(() => {
    if (!measure) setMpts([]);
  }, [measure]);

  // Stop tracking and drop the marker on unmount.
  useEffect(
    () => () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
    },
    [],
  );

  // Selection highlight via feature-state
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const feats = map.querySourceFeatures("buildings");
    feats.forEach((f) => {
      if (typeof f.id !== "number") return;
      map.setFeatureState({ source: "buildings", id: f.id }, {
        select: (f.properties as { id?: string }).id === selectedId,
      });
    });
  }, [selectedId, loaded]);

  return (
    <div className="mwm-root relative h-full w-full">
      {/* NOTE: not `absolute inset-0` — MapLibre forces `.maplibregl-map {
          position: relative }`, which voids inset sizing and collapses the
          container to height 0. Give it an explicit size instead. */}
      <div ref={containerRef} className="h-full w-full" />
      {!preview && (
        <MapControls
          mode={mode}
          onMode={setMode}
          basemap={basemap}
          onBasemap={setBasemap}
          terrain={terrain}
          onTerrain={setTerrain}
          layers={layers}
          onLayers={setLayers}
          onFullscreen={() =>
            containerRef.current?.requestFullscreen?.().catch(() => {})
          }
          searchOpen={searchOpen}
          onSearchOpen={setSearchOpen}
          onPick={fly}
          onLocate={locate}
          locating={locating}
          tracking={tracking}
          measure={measure}
          onMeasure={setMeasure}
          onShareView={shareView}
        />
      )}
      {measure && mpts.length > 0 && (
        <div className="mwm-panel absolute bottom-14 left-1/2 z-30 -translate-x-1/2 px-3 py-2">
          <p className="mwm-metric text-[12px] text-[var(--fg)]">
            {measureReadout(mpts)}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[var(--muted-2)]">
            Click to add points{mpts.length >= 3 ? " · enclosed area shown" : ""} · Esc to exit
            <button
              type="button"
              className="ml-2 font-medium text-[var(--accent)] hover:underline"
              onClick={() => setMpts([])}
            >
              Clear
            </button>
          </p>
        </div>
      )}
      {measure && mpts.length === 0 && (
        <div className="mwm-panel absolute bottom-14 left-1/2 z-30 -translate-x-1/2 px-3 py-2">
          <p className="text-[11.5px] text-[var(--muted)]">
            Measure: click points on the map · Esc to exit
          </p>
        </div>
      )}
      {(locError || notice) && (
        <div
          className={`mwm-panel absolute right-3 z-30 max-w-[min(20rem,calc(100vw-1.5rem))] px-2.5 py-1.5 text-[12px] leading-snug ${locError ? "text-[var(--bad)]" : "text-[var(--fg)]"}`}
          style={{ top: "calc(var(--mwm-controls-top, 0.75rem) + 2.6rem)" }}
        >
          {locError ?? notice}
        </div>
      )}
    </div>
  );

  function shareView() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const url = `${window.location.origin}${window.location.pathname}#map=${map
      .getZoom()
      .toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
    history.replaceState(null, "", `#map=${url.split("#map=")[1]}`);
    void navigator.clipboard
      ?.writeText(url)
      .then(() => setNotice("View link copied to clipboard."))
      .catch(() => setNotice(url));
  }

  function applyFix(pos: GeolocationPosition, opts: { fly?: boolean } = {}) {
    const map = mapRef.current;
    if (!map) return;
    const { longitude, latitude, accuracy } = pos.coords;
    setUserLoc({ lng: longitude, lat: latitude, accuracy: accuracy ?? 0 });
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "gps-dot";
      el.appendChild(document.createElement("span"));
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([longitude, latitude])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([longitude, latitude]);
    }
    if (opts.fly) {
      map.flyTo({ center: [longitude, latitude], zoom: 16.5, duration: 1400 });
    }
  }

  function startWatch() {
    if (watchRef.current != null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => applyFix(pos),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }

  function locate() {
    const map = mapRef.current;
    if (!map || locating) return;
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("This browser does not support location.");
      return;
    }
    // Already tracking — recentre on the latest fix.
    if (userLoc && watchRef.current != null) {
      map.flyTo({ center: [userLoc.lng, userLoc.lat], zoom: 16.5, duration: 1400 });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setTracking(true);
        applyFix(pos, { fly: true });
        startWatch();
      },
      (err) => {
        setLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — allow it in your browser settings and try again."
            : err.code === err.TIMEOUT
              ? "Could not get a GPS fix. Try moving outdoors or somewhere with a clearer view of the sky."
              : "Location is unavailable right now.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  function fly(target: { lng: number; lat: number; buildingId?: string; label: string }) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [target.lng, target.lat], zoom: 17, duration: 1400 });
    if (target.buildingId) onSelectRef.current?.(target.buildingId);
    void target.label;
  }
});
