"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Me = { sub: string; email: string; name: string; role: string };
type Tab = "overview" | "links" | "submissions" | "objects" | "developers" | "webhooks" | "embed";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "links", label: "Scan Links" },
  { id: "submissions", label: "Submissions" },
  { id: "objects", label: "Map Objects" },
  { id: "developers", label: "Developers" },
  { id: "webhooks", label: "Webhooks" },
  { id: "embed", label: "Embed & Share" },
];

type ProjectDetail = {
  project: {
    id: string;
    name: string;
    visibility: string;
    centerLat: number | null;
    centerLng: number | null;
  };
  access: string;
  stats: { buildings: number; objects: number; pendingSubmissions: number; members: number };
};

type LinkRow = {
  id: string;
  token: string;
  label: string | null;
  scope: string;
  fenceType: string;
  allowVideo: boolean;
  allowPhotos: boolean;
  requireApproval: boolean;
  maxSubmissions: number | null;
  usedSubmissions: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type SubmissionRow = {
  id: string;
  kind: string;
  name: string | null;
  category: string | null;
  contributorName: string | null;
  captureCount: number;
  status: string;
  lat: number | null;
  lng: number | null;
  formData: Record<string, unknown> | null;
  reviewNote: string | null;
  createdAt: string;
};

type ObjectRow = {
  id: string;
  type: string;
  name: string;
  verification: string;
  confidence: number;
  status: string;
  createdAt: string;
};

type KeyRow = {
  id: string;
  name: string;
  publicKey: string;
  secretPrefix: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

type Usage = {
  requestsToday: number;
  requestsThisMonth: number;
  successfulThisMonth: number;
  failedThisMonth: number;
  byRoute: { route: string; method: string; n: number }[];
};

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  status: string;
  secret: string;
};

export default function ProjectWorkspace({
  me,
  projectId,
  access,
}: {
  me: Me;
  projectId: string;
  access: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const canManage = access === "owner" || access === "editor";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)] px-4 py-2.5">
        <Link href="/dashboard" className="font-display text-[14px] font-semibold">
          <span className="text-[var(--accent)]">◂</span> My Maps
        </Link>
        <span className="text-[11.5px] text-[var(--muted)]">{me.email} · {access}</span>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          <Link href={`/map?project=${projectId}`} className="mwm-btn">Open Map</Link>
          <button type="button" onClick={logout} className="mwm-btn">Sign out</button>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mwm-btn shrink-0 ${tab === t.id ? "mwm-btn-on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-6xl p-4">
        {tab === "overview" && <Overview projectId={projectId} />}
        {tab === "links" && <ScanLinks projectId={projectId} canManage={canManage} />}
        {tab === "submissions" && <Submissions projectId={projectId} canManage={canManage} />}
        {tab === "objects" && <Objects projectId={projectId} />}
        {tab === "developers" && <Developers projectId={projectId} canManage={canManage} />}
        {tab === "webhooks" && <Webhooks projectId={projectId} canManage={canManage} />}
        {tab === "embed" && <Embed projectId={projectId} />}
      </main>
    </div>
  );
}

/* eslint-disable react-hooks/exhaustive-deps */

function usePoll<T>(fn: () => Promise<T>, ms = 8000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const memo = useCallback(fn, deps);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await memo();
        if (alive) setData(d);
      } catch {
        /* keep previous data */
      }
    };
    void load();
    const iv = setInterval(() => void load(), ms);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [memo, ms]);
  return data;
}

/* ------------------------------- overview ------------------------------- */

function Overview({ projectId }: { projectId: string }) {
  const data = usePoll<ProjectDetail>(async () => {
    const r = await fetch(`/api/projects/${projectId}`);
    if (!r.ok) throw new Error();
    return r.json();
  }, 8000, [projectId]);
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const { project, stats } = data;
  const cards: [string, number][] = [
    ["Buildings", stats.buildings],
    ["Map objects", stats.objects],
    ["Pending submissions", stats.pendingSubmissions],
    ["Members", stats.members],
  ];
  return (
    <div>
      <h1 className="font-display text-lg font-semibold">{project.name}</h1>
      <p className="text-[12px] text-[var(--muted)]">
        Visibility: {project.visibility.replace("_", " ")}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cards.map(([label, n]) => (
          <div key={label} className="mwm-panel p-3">
            <p className="font-display text-xl font-semibold tabular">{n}</p>
            <p className="text-[11px] text-[var(--muted)]">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ scan links ------------------------------ */

function ScanLinks({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const links = usePoll<{ links: LinkRow[] }>(async () => {
    const r = await fetch(`/api/links?projectId=${projectId}`);
    if (!r.ok) throw new Error();
    return r.json();
  }, 8000, [projectId]);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    scope: "area",
    fenceType: "circle",
    centerLat: "",
    centerLng: "",
    radiusM: "250",
    polygon: "",
    requireLogin: false,
    requireGps: true,
    minGpsAccuracyM: "",
    allowPhotos: true,
    allowVideo: true,
    allowBuildingScan: true,
    allowAreaScan: false,
    requireApproval: true,
    autoPublish: false,
    maxSubmissions: "",
    expiresInDays: "30",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        projectId,
        label: form.label,
        scope: form.scope,
        fenceType: form.fenceType,
        requireLogin: form.requireLogin,
        requireGps: form.requireGps,
        allowPhotos: form.allowPhotos,
        allowVideo: form.allowVideo,
        allowBuildingScan: form.allowBuildingScan,
        allowAreaScan: form.allowAreaScan,
        requireApproval: form.requireApproval,
        autoPublish: form.autoPublish,
        maxSubmissions: form.maxSubmissions ? Number(form.maxSubmissions) : null,
        expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null,
      };
      if (form.scope !== "global") {
        if (form.fenceType === "circle") {
          body.centerLat = Number(form.centerLat);
          body.centerLng = Number(form.centerLng);
          body.radiusM = Number(form.radiusM);
        } else if (form.fenceType === "rectangle") {
          body.polygon = form.polygon.split(",").map((n) => Number(n.trim()));
        } else {
          body.polygon = form.polygon
            .split(";")
            .map((p) => p.split(",").map((n) => Number(n.trim())));
        }
      }
      if (form.minGpsAccuracyM) body.minGpsAccuracyM = Number(form.minGpsAccuracyM);
      const r = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not create link");
      setShowForm(false);
      await navigator.clipboard?.writeText(j.scanUrl).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: string) => {
    await fetch(`/api/links/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    window.location.reload();
  };

  const scanUrl = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/scan/${token}`;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">Scan links</h1>
        {canManage && (
          <button type="button" className="mwm-btn mwm-btn-on" onClick={() => setShowForm(true)}>
            + Create scan link
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Everything contributed through a link belongs to this project automatically.
      </p>

      {showForm && (
        <div className="mwm-panel mt-4 space-y-3 p-4">
          <h2 className="font-display text-[14px] font-semibold">Configure scan link</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[12px] text-[var(--muted)]">Link name</label>
              <input className="mwm-input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Kariakoo block scan" />
            </div>
            <div>
              <label className="text-[12px] text-[var(--muted)]">Target area</label>
              <select className="mwm-input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="global">Anywhere</option>
                <option value="area">Restricted area (geo-fence)</option>
                <option value="location">One specific location</option>
              </select>
            </div>
            {form.scope !== "global" && (
              <>
                <div>
                  <label className="text-[12px] text-[var(--muted)]">Fence shape</label>
                  <select className="mwm-input" value={form.fenceType} onChange={(e) => setForm({ ...form, fenceType: e.target.value })}>
                    <option value="circle">Circle (center + radius)</option>
                    <option value="rectangle">Rectangle (bbox)</option>
                    <option value="polygon">Polygon (lng,lat; lng,lat; …)</option>
                  </select>
                </div>
                {form.fenceType === "circle" && (
                  <>
                    <div>
                      <label className="text-[12px] text-[var(--muted)]">Center lat</label>
                      <input className="mwm-input" value={form.centerLat} onChange={(e) => setForm({ ...form, centerLat: e.target.value })} placeholder="-6.7924" />
                    </div>
                    <div>
                      <label className="text-[12px] text-[var(--muted)]">Center lng</label>
                      <input className="mwm-input" value={form.centerLng} onChange={(e) => setForm({ ...form, centerLng: e.target.value })} placeholder="39.2083" />
                    </div>
                    <div>
                      <label className="text-[12px] text-[var(--muted)]">Radius (m)</label>
                      <input className="mwm-input" value={form.radiusM} onChange={(e) => setForm({ ...form, radiusM: e.target.value })} />
                    </div>
                  </>
                )}
                {form.fenceType !== "circle" && (
                  <div className="sm:col-span-2">
                    <label className="text-[12px] text-[var(--muted)]">
                      {form.fenceType === "rectangle" ? "Bounding box (minLng,minLat,maxLng,maxLat)" : "Polygon points (lng,lat; lng,lat; …)"}
                    </label>
                    <input className="mwm-input" value={form.polygon} onChange={(e) => setForm({ ...form, polygon: e.target.value })} />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="text-[12px] text-[var(--muted)]">Max submissions (blank = ∞)</label>
              <input className="mwm-input" value={form.maxSubmissions} onChange={(e) => setForm({ ...form, maxSubmissions: e.target.value })} />
            </div>
            <div>
              <label className="text-[12px] text-[var(--muted)]">Expires in days (blank = never)</label>
              <input className="mwm-input" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} />
            </div>
            <div>
              <label className="text-[12px] text-[var(--muted)]">Min GPS accuracy (m, blank = platform default)</label>
              <input className="mwm-input" value={form.minGpsAccuracyM} onChange={(e) => setForm({ ...form, minGpsAccuracyM: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
            {(
              [
                ["requireLogin", "Require login"],
                ["requireGps", "Require GPS"],
                ["allowPhotos", "Allow photos"],
                ["allowVideo", "Allow video"],
                ["allowBuildingScan", "Building scanning"],
                ["allowAreaScan", "Area scanning"],
                ["requireApproval", "Require approval"],
                ["autoPublish", "Auto-publish on submit"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form[key] as boolean}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          {error && <p className="text-[12px] text-[var(--bad)]">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="mwm-primary" disabled={busy} onClick={create}>
              {busy ? "Generating…" : "Generate link"}
            </button>
            <button type="button" className="mwm-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {links === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {links?.links.length === 0 && (
          <p className="text-sm text-[var(--muted)]">No scan links yet.</p>
        )}
        {links?.links.map((l) => (
          <div key={l.id} className="mwm-panel flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13.5px] font-semibold">{l.label ?? "Scan link"}</p>
              <p className="text-[11.5px] text-[var(--muted)]">
                {l.scope} · {l.fenceType} fence ·{" "}
                {l.usedSubmissions}/{l.maxSubmissions ?? "∞"} submissions ·{" "}
                {l.expiresAt ? `expires ${new Date(l.expiresAt).toLocaleDateString()}` : "no expiry"}
                {l.revokedAt && " · REVOKED"}
              </p>
            </div>
            <code className="rounded bg-[var(--bg-2)] px-2 py-1 text-[11.5px]">/scan/{l.token}</code>
            <button
              type="button"
              className="mwm-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(scanUrl(l.token));
                setCopied(l.id);
                setTimeout(() => setCopied(null), 2000);
              }}
            >
              {copied === l.id ? "Copied!" : "Copy link"}
            </button>
            <a href={scanUrl(l.token)} target="_blank" rel="noreferrer" className="mwm-btn">Open</a>
            {canManage && (
              <button
                type="button"
                className="mwm-btn"
                onClick={() => act(l.id, l.revokedAt ? "restore" : "revoke")}
              >
                {l.revokedAt ? "Restore" : "Revoke"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ submissions ------------------------------ */

function Submissions({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [status, setStatus] = useState("pending");
  const data = usePoll<{ submissions: SubmissionRow[] }>(async () => {
    const r = await fetch(`/api/submissions?projectId=${projectId}&status=${status}`);
    if (!r.ok) throw new Error();
    return r.json();
  }, 8000, [projectId, status]);
  const [note, setNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const act = async (id: string, action: string, reviewNote?: string) => {
    await fetch(`/api/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: reviewNote }),
    });
    window.location.reload();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">Submissions</h1>
        <div className="ml-auto flex gap-1">
          {["pending", "approved", "rejected", "needs_imagery"].map((s) => (
            <button
              key={s}
              type="button"
              className={`mwm-btn ${status === s ? "mwm-btn-on" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {data === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {data?.submissions.length === 0 && (
          <p className="text-sm text-[var(--muted)]">No {status.replace("_", " ")} submissions.</p>
        )}
        {data?.submissions.map((s) => (
          <div key={s.id} className="mwm-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-[13.5px] font-semibold">
                {s.name ?? "Unnamed submission"}
              </p>
              <span className="mwm-badge badge-muted">{s.kind}</span>
              {s.category && <span className="mwm-badge badge-muted">{s.category}</span>}
              <span className="ml-auto text-[11px] text-[var(--muted)]">
                {s.contributorName ?? "anonymous"} · {s.captureCount} captures ·{" "}
                {new Date(s.createdAt).toLocaleString()}
              </span>
            </div>
            {s.lat != null && (
              <p className="mt-1 text-[11.5px] tabular text-[var(--muted)]">
                {s.lat.toFixed(6)}, {s.lng?.toFixed(6)}
              </p>
            )}
            {s.formData && Object.keys(s.formData).length > 0 && (
              <p className="mt-1 text-[11.5px] text-[var(--muted)]">
                {Object.entries(s.formData)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .slice(0, 6)
                  .join(" · ")}
              </p>
            )}
            {openId === s.id && (
              <textarea
                className="mwm-input mt-2"
                rows={2}
                placeholder="Review note (optional) — sent with the decision"
                value={note ?? ""}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            {canManage && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="mwm-btn" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                  {openId === s.id ? "Close note" : "Add note"}
                </button>
                <button type="button" className="mwm-btn mwm-btn-on" onClick={() => act(s.id, "approve", note ?? undefined)}>
                  Approve
                </button>
                <button type="button" className="mwm-btn" onClick={() => act(s.id, "needs_imagery", note ?? "Please add more photographs.")}>
                  Request imagery
                </button>
                <button type="button" className="mwm-btn" onClick={() => act(s.id, "reject", note ?? undefined)}>
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- objects -------------------------------- */

function Objects({ projectId }: { projectId: string }) {
  const data = usePoll<{ objects: ObjectRow[] }>(async () => {
    const r = await fetch(`/api/objects?projectId=${projectId}`);
    if (!r.ok) throw new Error();
    return r.json();
  }, 10000, [projectId]);
  return (
    <div>
      <h1 className="font-display text-lg font-semibold">Map objects</h1>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Buildings, locations and other objects on this map. Approving a submission creates one.
      </p>
      <div className="mt-4 space-y-2">
        {data === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {data?.objects.length === 0 && <p className="text-sm text-[var(--muted)]">No objects yet.</p>}
        {data?.objects.map((o) => (
          <div key={o.id} className="mwm-panel flex flex-wrap items-center gap-3 p-3">
            <p className="font-display text-[13.5px] font-semibold">{o.name}</p>
            <span className="mwm-badge badge-muted">{o.type}</span>
            <span
              className={`mwm-badge ${
                o.verification === "verified" ? "badge-ok" : o.verification === "estimated" ? "badge-warn" : "badge-muted"
              }`}
            >
              {o.verification}
            </span>
            <span className="text-[11px] tabular text-[var(--muted)]">
              confidence {Math.round(o.confidence * 100)}%
            </span>
            <span className="ml-auto text-[11px] text-[var(--muted)]">
              {new Date(o.createdAt).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ developers ------------------------------ */

const ALL_SCOPES = [
  "maps:read", "maps:write", "buildings:read", "buildings:write",
  "locations:read", "locations:write", "models:read", "models:write", "analytics:read",
];

function Developers({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const data = usePoll<{ keys: KeyRow[]; availableScopes: string[] }>(async () => {
    const r = await fetch(`/api/keys?projectId=${projectId}`);
    if (!r.ok) throw new Error();
    return r.json();
  }, 10000, [projectId]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"secret" | "public">("secret");
  const [scopes, setScopes] = useState<string[]>(["maps:read", "buildings:read", "locations:read", "models:read"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, type, scopes }),
      });
      const j = await r.json();
      if (r.ok) {
        setNewSecret(j.secret ?? j.publicKey);
        setCreating(false);
        setName("");
      }
    } finally {
      setBusy(false);
    }
  };

  const keyAction = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch(`/api/keys/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, usage: true, ...extra }),
    });
    const j = await r.json();
    if (j.rotatedSecret) setNewSecret(j.rotatedSecret);
    if (j.usage) setUsage((u) => ({ ...u, [id]: j.usage }));
    if (!j.usage) window.location.reload();
  };

  const loadUsage = async (id: string) => {
    const r = await fetch(`/api/keys/${id}`);
    if (r.ok) {
      const j = await r.json();
      setUsage((u) => ({ ...u, [id]: j.usage }));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">API keys</h1>
        {canManage && (
          <button type="button" className="mwm-btn mwm-btn-on" onClick={() => setCreating(true)}>
            + Create key
          </button>
        )}
      </div>

      {newSecret && (
        <div className="mwm-panel mt-4 border-[var(--warn)] p-4">
          <p className="font-display text-[13.5px] font-semibold">
            Copy your secret now — it will never be shown again
          </p>
          <code className="mt-2 block break-all rounded bg-[var(--bg-2)] p-2 text-[12px]">{newSecret}</code>
          <button type="button" className="mwm-btn mt-2" onClick={() => setNewSecret(null)}>
            I saved it
          </button>
        </div>
      )}

      {creating && (
        <div className="mwm-panel mt-4 space-y-3 p-4">
          <div>
            <label className="text-[12px] text-[var(--muted)]">Key name</label>
            <input className="mwm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My mobile app" />
          </div>
          <div>
            <label className="text-[12px] text-[var(--muted)]">Key type</label>
            <select className="mwm-input" value={type} onChange={(e) => setType(e.target.value as "secret" | "public")}>
              <option value="secret">Secret (server-side, full scopes)</option>
              <option value="public">Public (browser/embed, read-only)</option>
            </select>
          </div>
          <div>
            <p className="text-[12px] text-[var(--muted)]">Scopes</p>
            <div className="mt-1 flex flex-wrap gap-2 text-[12px]">
              {ALL_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                    }
                  />
                  <code>{s}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="mwm-primary" disabled={!name.trim() || busy} onClick={create}>
              {busy ? "Creating…" : "Create key"}
            </button>
            <button type="button" className="mwm-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {data === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {data?.keys.length === 0 && <p className="text-sm text-[var(--muted)]">No API keys yet.</p>}
        {data?.keys.map((k) => (
          <div key={k.id} className="mwm-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-[13.5px] font-semibold">{k.name}</p>
              <span className={`mwm-badge ${k.status === "active" ? "badge-ok" : "badge-bad"}`}>{k.status}</span>
              <code className="text-[11px] text-[var(--muted)]">{k.publicKey.slice(0, 20)}…</code>
              <span className="ml-auto text-[11px] text-[var(--muted)]">
                {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">{(k.scopes ?? []).join(" · ")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" className="mwm-btn" onClick={() => void loadUsage(k.id)}>Usage</button>
              {canManage && (
                <>
                  <button type="button" className="mwm-btn" onClick={() => keyAction(k.id, "rotate")}>Rotate</button>
                  <button type="button" className="mwm-btn" onClick={() => keyAction(k.id, k.status === "active" ? "revoke" : "restore")}>
                    {k.status === "active" ? "Revoke" : "Restore"}
                  </button>
                </>
              )}
            </div>
            {usage[k.id] && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                <div><p className="font-display font-semibold tabular">{usage[k.id].requestsToday}</p><p className="text-[10.5px] text-[var(--muted)]">requests today</p></div>
                <div><p className="font-display font-semibold tabular">{usage[k.id].requestsThisMonth}</p><p className="text-[10.5px] text-[var(--muted)]">this month</p></div>
                <div><p className="font-display font-semibold tabular">{usage[k.id].successfulThisMonth}</p><p className="text-[10.5px] text-[var(--muted)]">successful</p></div>
                <div><p className="font-display font-semibold tabular">{usage[k.id].failedThisMonth}</p><p className="text-[10.5px] text-[var(--muted)]">failed</p></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mwm-panel mt-6 p-4">
        <h2 className="font-display text-[14px] font-semibold">Quick start</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-2)] p-3 text-[11.5px]">{`curl "https://YOURDOMAIN/api/v1/maps" \\
  -H "Authorization: Bearer mk_secret_…"`}</pre>
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          Full API reference: <Link href="/api/docs" className="text-[var(--accent)]">/api/docs</Link> · SDK guide in SDK.md
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- webhooks -------------------------------- */

const EVENTS = [
  "scan.created", "scan.completed", "building.detected", "building.reconstructed",
  "building.approved", "location.created", "model.updated",
  "submission.approved", "submission.rejected",
];

function Webhooks({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const data = usePoll<{ webhooks: WebhookRow[]; deliveries: { id: string; event: string; status: string; attempts: number; error: string | null; createdAt: string }[] }>(
    async () => {
      const r = await fetch(`/api/webhooks?projectId=${projectId}`);
      if (!r.ok) throw new Error();
      return r.json();
    },
    8000,
    [projectId],
  );
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url, events }),
      });
      const j = await r.json();
      if (r.ok) {
        setSecret(j.secret);
        setUrl("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-lg font-semibold">Webhooks</h1>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Signed with HMAC-SHA256 (X-MyMap-Signature). Retries with exponential backoff.
      </p>

      {secret && (
        <div className="mwm-panel mt-3 border-[var(--warn)] p-4">
          <p className="font-display text-[13.5px] font-semibold">Signing secret — shown once</p>
          <code className="mt-2 block break-all rounded bg-[var(--bg-2)] p-2 text-[12px]">{secret}</code>
          <button type="button" className="mwm-btn mt-2" onClick={() => setSecret(null)}>I saved it</button>
        </div>
      )}

      {canManage && (
        <div className="mwm-panel mt-4 space-y-3 p-4">
          <div>
            <label className="text-[12px] text-[var(--muted)]">Endpoint URL</label>
            <input className="mwm-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourapp.com/hooks/mymap" />
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={events.includes(e)}
                  onChange={(ev) =>
                    setEvents((cur) => (ev.target.checked ? [...cur, e] : cur.filter((x) => x !== e)))
                  }
                />
                <code>{e}</code>
              </label>
            ))}
          </div>
          <button type="button" className="mwm-primary" disabled={!url.trim() || busy} onClick={create}>
            {busy ? "Creating…" : "Create webhook"}
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {data === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {data?.webhooks.length === 0 && <p className="text-sm text-[var(--muted)]">No webhooks yet.</p>}
        {data?.webhooks.map((w) => (
          <div key={w.id} className="mwm-panel flex flex-wrap items-center gap-2 p-3">
            <p className="min-w-0 flex-1 truncate text-[12.5px]">{w.url}</p>
            <span className={`mwm-badge ${w.status === "active" ? "badge-ok" : "badge-bad"}`}>{w.status}</span>
            {canManage && (
              <button
                type="button"
                className="mwm-btn"
                onClick={async () => {
                  await fetch("/api/webhooks", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: w.id, action: w.status === "active" ? "disable" : "enable" }),
                  });
                  window.location.reload();
                }}
              >
                {w.status === "active" ? "Disable" : "Enable"}
              </button>
            )}
          </div>
        ))}
        {data?.deliveries.slice(0, 10).map((d) => (
          <p key={d.id} className="text-[11px] text-[var(--muted)]">
            {new Date(d.createdAt).toLocaleString()} · <code>{d.event}</code> · {d.status} ·{" "}
            {d.attempts} attempt{d.attempts === 1 ? "" : "s"} {d.error ? `· ${d.error}` : ""}
          </p>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- embed --------------------------------- */

function Embed({ projectId }: { projectId: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://YOURDOMAIN";
  const [height, setHeight] = useState("600");
  const iframeCode = useMemo(
    () =>
      `<iframe\n  src="${origin}/embed/${projectId}"\n  width="100%"\n  height="${height}"\n  style="border:0"\n  allowfullscreen\n  loading="lazy">\n</iframe>`,
    [origin, projectId, height],
  );
  return (
    <div>
      <h1 className="font-display text-lg font-semibold">Embed & share</h1>
      <div className="mwm-panel mt-4 p-4">
        <label className="text-[12px] text-[var(--muted)]">Embed height (px)</label>
        <input className="mwm-input max-w-40" value={height} onChange={(e) => setHeight(e.target.value)} />
        <p className="mt-3 text-[12px] text-[var(--muted)]">Paste this into any website:</p>
        <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-2)] p-3 text-[11.5px]">{iframeCode}</pre>
        <a href={`/embed/${projectId}`} target="_blank" rel="noreferrer" className="mwm-btn mt-3 inline-block">
          Preview embed
        </a>
      </div>
      <div className="mwm-panel mt-3 p-4 text-[12.5px]">
        <p><span className="text-[var(--muted)]">Map link:</span> {origin}/map?project={projectId}</p>
        <p className="mt-1"><span className="text-[var(--muted)]">Embed page:</span> {origin}/embed/{projectId}</p>
        <p className="mt-1"><span className="text-[var(--muted)]">Scan links:</span> created under Scan Links — /scan/TOKEN</p>
      </div>
    </div>
  );
}
