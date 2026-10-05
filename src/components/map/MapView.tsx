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
  const [basemap, setBasemap] = useState<"satellite" | "dark">("satellite");
  const [terrain, setTerrain] = useState(false);
  const [layers, setLayers] = useState({ buildings: true, captures: false, coverage: true });
  const [searchOpen, setSearchOpen] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lng: number; lat: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const watchRef = useRef<number | null>(null);
  /** Set once the MapLibre style has fully loaded — every style-mutating
   *  effect must wait for this, or MapLibre throws "Style is not done
   *  loading" and React unmounts the whole tree. */
  const [loaded, setLoaded] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onSelectRef = useRef(onSelectBuilding);
  onSelectRef.current = onSelectBuilding;
  const fetchSeq = useRef(0);

  useImperativeHandle(ref, () => ({
    flyTo: (lng, lat, zoom = 17) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1400 });
    },
  }));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      // keep the drawing buffer readable (debug tooling + future export)
      canvasContextAttributes: { preserveDrawingBuffer: true },
      center: preview ? PREVIEW_CENTER : CENTER,
      zoom: preview ? 4 : 13,
      pitch: preview ? 35 : 62,
      minZoom: 2,
      maxZoom: 19,
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
      map.addLayer({ id: "sat-layer", type: "raster", source: "sat" });
      map.addLayer({ id: "sat-labels-layer", type: "raster", source: "sat-labels" });
      map.addLayer(
        { id: "dark-layer", type: "raster", source: "dark" },
        "sat-layer",
      );
      map.setLayoutProperty("dark-layer", "visibility", "none");

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

      map.on("click", (e: maplibregl.MapMouseEvent) => {
        if (preview) return;
        const feats = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-3d", "buildings-fill", "buildings-outline", "buildings-point"],
        });
        const id = (feats[0]?.properties as { id?: string } | undefined)?.id;
        onSelectRef.current?.(id ?? null);
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
            }
          })
          .catch(() => {});
      };
      map.on("moveend", () => {
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

  // 2D / 3D (style mutations only after the style has loaded)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.easeTo({ pitch: mode === "3d" ? 62 : 0, duration: 900 });
    map.setLayoutProperty("buildings-fill", "visibility", mode === "3d" ? "none" : "visible");
    map.setLayoutProperty("buildings-3d", "visibility", mode === "3d" ? "visible" : "none");
  }, [mode, loaded]);

  // Basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const setVis = (id: string, v: "visible" | "none") => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    };
    if (basemap === "satellite") {
      setVis("dark-layer", "none");
      setVis("sat-layer", "visible");
      setVis("sat-labels-layer", "visible");
    } else {
      setVis("dark-layer", "visible");
      setVis("sat-layer", "none");
      setVis("sat-labels-layer", "none");
    }
  }, [basemap, loaded]);

  // Terrain
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
      }
      map.setTerrain({ source: "dem", exaggeration: 1.4 });
    } else {
      map.setTerrain(null);
    }
  }, [terrain]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const show = (on: boolean) => (on ? "visible" : "none");
    if (map.getLayer("coverage-fill"))
      map.setLayoutProperty("coverage-fill", "visibility", show(layers.coverage));
    if (map.getLayer("captures-circles"))
      map.setLayoutProperty("captures-circles", "visibility", show(layers.captures));
    const bvis = show(layers.buildings);
    for (const id of ["buildings-fill", "buildings-3d", "buildings-outline", "buildings-point"]) {
      if (map.getLayer(id)) {
        if (id === "buildings-fill") continue; // managed by 2D/3D toggle
        map.setLayoutProperty(id, "visibility", bvis);
      }
    }
  }, [layers, mode, loaded]);

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
        />
      )}
      {locError && (
        <div
          className="mwm-panel absolute right-3 z-30 max-w-[min(20rem,calc(100vw-1.5rem))] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--bad)]"
          style={{ top: "calc(var(--mwm-controls-top, 0.75rem) + 2.6rem)" }}
        >
          {locError}
        </div>
      )}
    </div>
  );

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
