"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const MapView = dynamic(
  () => import("./MapView").then((m) => m.MapView),
  { ssr: false },
);
import type { MapViewHandle } from "./MapView";

type Detail = {
  building: {
    id: string;
    name: string | null;
    centerLat: number;
    centerLng: number;
    altitude: number | null;
    status: string;
    verification: string;
    currentVersion: number;
    requestedImagery: string | null;
  };
  versions: {
    id: string;
    version: number;
    type: string;
    engine: string;
    state: string;
    confidence: number;
    heightM: number | null;
    floors: number | null;
    buildingType: string;
    roofType: string;
    modelUrl: string | null;
    metrics: Record<string, unknown> | null;
    createdAt: string;
  }[];
  captures: {
    id: string;
    kind: string;
    status: string;
    gpsLat: number | null;
    gpsLng: number | null;
    gpsAltitude: number | null;
    gpsHAccuracy: number | null;
    gpsHeading: number | null;
    quality: Record<string, unknown> | null;
    thumbnailUrl: string | null;
    url: string;
    createdAt: string;
  }[];
  sessions: { id: string; contributorName: string | null; startedAt: string }[];
};

const TYPE_LABEL: Record<string, string> = {
  estimated_single_image: "Estimated · single photo",
  estimated_multi_view: "Estimated · multi-view",
  photogrammetry: "Photogrammetry",
  neural: "Neural reconstruction",
  manual: "Manual",
};

/** Group captures by rough cardinal direction from their heading. */
function groupCapturesByAngle(captures: Detail["captures"]) {
  const groups: Record<string, Detail["captures"]> = {
    front: [],
    right: [],
    rear: [],
    left: [],
    other: [],
  };
  for (const c of captures) {
    const h = c.gpsHeading;
    if (h == null) {
      groups.other.push(c);
      continue;
    }
    const norm = ((h % 360) + 360) % 360;
    if (norm >= 315 || norm < 45) groups.front.push(c);
    else if (norm >= 45 && norm < 135) groups.right.push(c);
    else if (norm >= 135 && norm < 225) groups.rear.push(c);
    else if (norm >= 225 && norm < 315) groups.left.push(c);
    else groups.other.push(c);
  }
  return groups;
}

export function MapPageShell({
  visibility,
  initialBuildingId = null,
}: {
  visibility: "public" | "invite_only" | "private";
  initialBuildingId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialBuildingId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const mapRef = useRef<MapViewHandle>(null);
  const flyRef = useRef<string | null>(null);
  if (initialBuildingId) flyRef.current = initialBuildingId;

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setMe(j.user ?? null))
      .catch(() => setMe(null));
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/buildings/${id}`);
      if (r.ok) setDetail((await r.json()) as Detail);
      else setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void load(selected);
    else setDetail(null);
  }, [selected, load]);

  // Fly to the building once the map has its data (first render race).
  useEffect(() => {
    if (detail && flyRef.current === detail.building.id) {
      mapRef.current?.flyTo(detail.building.centerLng, detail.building.centerLat, 17);
      flyRef.current = null;
    }
  }, [detail]);

  const act = async (action: string, extra?: Record<string, unknown>) => {
    if (!detail) return;
    const r = await fetch(`/api/buildings/${detail.building.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error ?? "Action failed");
      return;
    }
    if (action === "request_imagery") {
      const j = (await r.json()) as { contributePath?: string };
      if (j.contributePath) {
        const url = `${window.location.origin}${j.contributePath}`;
        await navigator.clipboard?.writeText(url).catch(() => {});
        alert(`Imagery request saved. Contributor link (copied to clipboard):\n${url}`);
      }
    }
    if (action === "delete") {
      setSelected(null);
      return;
    }
    void load(detail.building.id);
  };

  const rename = async () => {
    if (!detail) return;
    const name = window.prompt("Building name", detail.building.name ?? "");
    if (name) await act("rename", { name });
  };

  const latest = detail?.versions[detail.versions.length - 1];

  return (
    <div
      className="relative h-dvh bg-[var(--bg-2)]"
      style={{ ["--mwm-controls-top" as string]: "3.6rem" }}
    >
      <MapView
        ref={mapRef}
        selectedId={selected}
        onSelectBuilding={(id) => {
          setSelected(id);
          flyRef.current = id;
        }}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 p-3">
        <Link
          href="/"
          className="mwm-panel pointer-events-auto flex items-center gap-2 px-3 py-2"
        >
          <img
            src="/logo.png"
            alt="My View"
            className="h-6 w-6 flex-none rounded-[var(--r-1)] object-cover"
          />
          <span className="font-display text-[13px] font-semibold">
            3D Map
          </span>
          <span className="mwm-badge badge-muted">{visibility}</span>
        </Link>
        {/* Legend sits on the left so it never covers the map controls
            (search / layers / fullscreen) in the top-right corner. */}
        <div className="mwm-panel pointer-events-auto hidden items-center gap-3 px-3 py-2 text-[11px] text-[var(--muted)] sm:flex">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-sm bg-[var(--bad)]" /> low
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-sm bg-[var(--warn)]" /> medium
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-sm bg-[var(--ok)]" /> high
          </span>
          <span className="text-[var(--line)]">|</span>
          <span>
            height = extrusion · dashed outline = unverified estimate
          </span>
        </div>
      </div>

      {/* Building panel */}
      {selected && (
        <div className="mwm-panel absolute bottom-4 right-3 top-16 z-30 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] p-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-[15px] font-semibold">
                {detail?.building.name ?? "Building"}
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--muted)] tabular">
                {detail
                  ? `${detail.building.centerLat.toFixed(5)}, ${detail.building.centerLng.toFixed(5)}`
                  : "…"}{" "}
                · v{detail?.building.currentVersion ?? "–"}
              </p>
              {detail?.building.requestedImagery && (
                <p className="mt-1.5 rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[11px] text-[var(--accent)]">
                  Imagery requested: {detail.building.requestedImagery}
                </p>
              )}
            </div>
            <button
              type="button"
              className="rounded-[var(--r-1)] p-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              onClick={() => setSelected(null)}
              aria-label="Close panel"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
            {loading && <p className="text-[var(--muted)]">Loading dossier…</p>}
            {detail && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`mwm-badge ${
                      detail.building.status === "approved"
                        ? "badge-ok"
                        : detail.building.status === "rejected"
                        ? "badge-bad"
                        : "badge-warn"
                    }`}
                  >
                    {detail.building.status}
                  </span>
                  <span className="mwm-badge badge-muted">
                    {TYPE_LABEL[latest?.type ?? ""] ?? latest?.type ?? "no model yet"}
                  </span>
                  {latest && (
                    <span
                      className={`mwm-badge ${
                        latest.confidence >= 0.6
                          ? "badge-ok"
                          : latest.confidence >= 0.35
                          ? "badge-warn"
                          : "badge-bad"
                      }`}
                    >
                      confidence {Math.round(latest.confidence * 100)}%
                    </span>
                  )}
                </div>

                {latest && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                    <dt className="text-[var(--muted)]">Height</dt>
                    <dd className="tabular">
                      {latest.heightM != null ? `${latest.heightM} m` : "unknown"}
                    </dd>
                    <dt className="text-[var(--muted)]">Floors</dt>
                    <dd className="tabular">
                      {latest.floors != null ? latest.floors : "unknown"}
                    </dd>
                    <dt className="text-[var(--muted)]">Type</dt>
                    <dd>{latest.buildingType}</dd>
                    <dt className="text-[var(--muted)]">Engine</dt>
                    <dd>{latest.engine}</dd>
                    <dt className="text-[var(--muted)]">Captures</dt>
                    <dd className="tabular">
                      {String(latest.metrics?.captureCount ?? detail.captures.length)}
                    </dd>
                    <dt className="text-[var(--muted)]">View arcs</dt>
                    <dd className="tabular">
                      {String(latest.metrics?.distinctArcs ?? "–")}/8
                    </dd>
                  </dl>
                )}

                <h3 className="mt-4 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Version history
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {[...detail.versions].reverse().map((v) => (
                    <li
                      key={v.id}
                      className={`rounded-md border px-2.5 py-1.5 ${
                        v.version === detail.building.currentVersion
                          ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]"
                          : "border-[var(--line)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-[11.5px] font-semibold">
                          v{v.version}
                          <span className="ml-1.5 font-sans font-normal text-[var(--muted)]">
                            {TYPE_LABEL[v.type] ?? v.type}
                          </span>
                        </span>
                        <span className="tabular text-[11px] text-[var(--muted)]">
                          {Math.round(v.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-[var(--muted)]">
                        {new Date(v.createdAt).toLocaleString()} · {v.engine}
                      </p>
                    </li>
                  ))}
                </ul>

                <h3 className="mt-4 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Captures ({detail.captures.length})
                </h3>
                {(() => {
                  const groups = groupCapturesByAngle(detail.captures);
                  const order = [
                    ["front", "Front"],
                    ["right", "Right"],
                    ["rear", "Rear"],
                    ["left", "Left"],
                    ["other", "Other"],
                  ];
                  return (
                    <div className="mt-2 space-y-3">
                      {order.map(([key, label]) => {
                        const arr = groups[key];
                        if (!arr.length) return null;
                        return (
                          <div key={key} className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-[0.1em]">
                              {label} ({arr.length})
                            </p>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {arr.map((c) => (
                                <a
                                  key={c.id}
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 group"
                                  title={`GPS ±${c.gpsHAccuracy ?? "?"}m · ${c.gpsHeading != null ? Math.round(c.gpsHeading) + "°" : "no heading"}`}
                                >
                                  <div className="relative h-20 w-20 rounded-md overflow-hidden ring-1 ring-[var(--line)] group-hover:ring-[var(--accent)] transition">
                                    {c.thumbnailUrl ? (
                                      <img
                                        src={c.thumbnailUrl}
                                        alt={`capture ${c.id.slice(0, 8)}`}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center bg-[var(--hover)] text-[10px] text-[var(--muted)]">
                                        video
                                      </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[9px] text-white">
                                      {c.gpsHAccuracy != null && `±${Math.round(c.gpsHAccuracy)}m`}
                                    </div>
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <h3 className="mt-4 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  Contributors
                </h3>
                <p className="mt-1 text-[11.5px]">
                  {detail.sessions.length
                    ? detail.sessions
                        .map((s) => s.contributorName ?? "Anonymous")
                        .join(", ")
                    : "—"}
                </p>
              </>
            )}
          </div>

          {me?.role === "admin" && detail && (
            <div className="grid grid-cols-2 gap-1.5 border-t border-[var(--line)] p-2.5 text-[11.5px]">
              <button
                type="button"
                className="mwm-primary !py-1.5 !text-[11.5px]"
                onClick={() => act("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="mwm-ghost !py-1.5 !text-[11.5px]"
                onClick={() => act("reject")}
              >
                Reject
              </button>
              <button
                type="button"
                className="mwm-ghost !py-1.5 !text-[11.5px]"
                onClick={() => act("reprocess")}
              >
                Reprocess
              </button>
              <button
                type="button"
                className="mwm-ghost !py-1.5 !text-[11.5px]"
                onClick={() => {
                  const note = window.prompt(
                    "What imagery is missing?",
                    "Please capture the left and rear sides of the building.",
                  );
                  if (note) void act("request_imagery", { note });
                }}
              >
                Request imagery
              </button>
              <button
                type="button"
                className="mwm-ghost !py-1.5 !text-[11.5px]"
                onClick={rename}
              >
                Rename
              </button>
              <button
                type="button"
                className="mwm-ghost !border-[var(--bad)]/40 !py-1.5 !text-[11.5px] !text-[var(--bad)]"
                onClick={() => {
                  if (window.confirm("Delete this building and its versions?"))
                    void act("delete");
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {selected && (
        <button
          type="button"
          className={`mwm-panel absolute bottom-4 left-3 z-30 px-3 py-1.5 text-[11px] ${
            panelOpen ? "hidden" : ""
          }`}
          onClick={() => setPanelOpen(true)}
        >
          Show panel
        </button>
      )}
    </div>
  );
}