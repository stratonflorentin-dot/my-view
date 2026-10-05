"use client";

import { useEffect, useRef, useState } from "react";

export type MapMode = "2d" | "3d";
export type Basemap = "satellite" | "dark";
export type LayerState = { buildings: boolean; captures: boolean; coverage: boolean };

type Props = {
  mode: MapMode;
  onMode: (m: MapMode) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  terrain: boolean;
  onTerrain: (t: boolean) => void;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  onFullscreen: () => void;
  searchOpen: boolean;
  onSearchOpen: (o: boolean) => void;
  onPick: (t: { lng: number; lat: number; buildingId?: string; label: string }) => void;
};

const Icon2D = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" />
  </svg>
);
const Icon3D = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
    <path d="M12 22V12M3 7l9 5 9-5" />
  </svg>
);
const IconSat = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M13 7 9 3 5 7l4 4M17 11l4 4-4 4-4-4M8 12l4 4 6-6-4-4ZM16 8l3-3" />
  </svg>
);
const IconDark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconMountain = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="m8 3 4 8 5-5 5 15H2L8 3Z" />
  </svg>
);
const IconExpand = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const IconLayers = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="m12 2 10 6-10 6L2 8l10-6Z" />
    <path d="m2 14 10 6 10-6" />
  </svg>
);

export function MapControls(p: Props) {
  const [layersOpen, setLayersOpen] = useState(false);
  return (
    <>
      {/* Top-left: mode + basemap + terrain */}
      <div className="mwm-panel absolute left-3 top-3 z-20 flex flex-col gap-1 p-1">
        <div className="flex gap-1">
          <button
            type="button"
            className={`mwm-btn ${p.mode === "2d" ? "mwm-btn-on" : ""}`}
            onClick={() => p.onMode("2d")}
            title="2D map"
          >
            <Icon2D /> 2D
          </button>
          <button
            type="button"
            className={`mwm-btn ${p.mode === "3d" ? "mwm-btn-on" : ""}`}
            onClick={() => p.onMode("3d")}
            title="3D view"
          >
            <Icon3D /> 3D
          </button>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className={`mwm-btn ${p.basemap === "satellite" ? "mwm-btn-on" : ""}`}
            onClick={() => p.onBasemap("satellite")}
            title="Satellite imagery"
          >
            <IconSat /> Sat
          </button>
          <button
            type="button"
            className={`mwm-btn ${p.basemap === "dark" ? "mwm-btn-on" : ""}`}
            onClick={() => p.onBasemap("dark")}
            title="Dark streets"
          >
            <IconDark /> Dark
          </button>
          <button
            type="button"
            className={`mwm-btn ${p.terrain ? "mwm-btn-on" : ""}`}
            onClick={() => p.onTerrain(!p.terrain)}
            title="Terrain relief"
          >
            <IconMountain />
          </button>
        </div>
      </div>

      {/* Top-right: search + layers + fullscreen */}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            className={`mwm-panel mwm-btn ${p.searchOpen ? "mwm-btn-on" : ""}`}
            onClick={() => p.onSearchOpen(!p.searchOpen)}
            title="Search"
          >
            <IconSearch />
          </button>
          <button
            type="button"
            className={`mwm-panel mwm-btn ${layersOpen ? "mwm-btn-on" : ""}`}
            onClick={() => setLayersOpen(!layersOpen)}
            title="Layers"
          >
            <IconLayers />
          </button>
          <button
            type="button"
            className="mwm-panel mwm-btn"
            onClick={p.onFullscreen}
            title="Full screen"
          >
            <IconExpand />
          </button>
        </div>
        {layersOpen && (
          <div className="mwm-panel w-44 p-2 text-xs">
            {(
              [
                ["buildings", "3D buildings"],
                ["captures", "Capture positions"],
                ["coverage", "Coverage grid"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--mwm-hover)]">
                <input
                  type="checkbox"
                  checked={p.layers[k]}
                  onChange={(e) => p.onLayers({ ...p.layers, [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      {p.searchOpen && <SearchBox onClose={() => p.onSearchOpen(false)} onPick={p.onPick} />}
    </>
  );
}

type Pick = { lng: number; lat: number; buildingId?: string; label: string };

function SearchBox({ onClose, onPick }: { onClose: () => void; onPick: (p: Pick) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const out: Pick[] = [];
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const j = await r.json();
          (j.results ?? []).forEach((b: { id: string; name: string | null; centerLat: number; centerLng: number }) => {
            out.push({
              lng: b.centerLng,
              lat: b.centerLat,
              buildingId: b.id,
              label: b.name || `Building ${b.id.slice(0, 8)}`,
            });
          });
        }
      } catch {
        /* offline — still try Nominatim */
      }
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
          { headers: { Accept: "application/json" } },
        );
        if (r.ok) {
          const j = await r.json();
          (Array.isArray(j) ? j : []).forEach((n: { lat: string; lon: string; display_name: string }) => {
            out.push({ lng: Number(n.lon), lat: Number(n.lat), label: n.display_name });
          });
        }
      } catch {
        /* nominatim unreachable */
      }
      if (id === seq.current) {
        setResults(out.slice(0, 8));
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mwm-panel absolute right-3 top-14 z-30 w-[min(20rem,calc(100vw-1.5rem))] p-2">
      <div className="flex items-center gap-2">
        <IconSearch />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Place, building, coordinates…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--mwm-muted)]"
        />
        <button type="button" className="text-[var(--mwm-muted)] hover:text-[var(--mwm-fg)]" onClick={onClose}>
          ✕
        </button>
      </div>
      {busy && <p className="px-2 py-1.5 text-xs text-[var(--mwm-muted)]">Searching…</p>}
      {results.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--mwm-hover)]"
                onClick={() => {
                  onPick(r);
                  onClose();
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!busy && q.trim() && results.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-[var(--mwm-muted)]">No results</p>
      )}
    </div>
  );
}
