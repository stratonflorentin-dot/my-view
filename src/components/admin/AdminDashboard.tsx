"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Me = { sub: string; email: string; name: string; role: string };
type Tab = "overview" | "links" | "buildings" | "jobs" | "users" | "settings" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "links", label: "Mapping Links" },
  { id: "buildings", label: "Buildings" },
  { id: "jobs", label: "Processing" },
  { id: "users", label: "Users" },
  { id: "settings", label: "Settings" },
  { id: "audit", label: "Audit" },
];

export default function AdminDashboard({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)] px-4 py-2.5">
        <Link href="/" className="font-display text-[14px] font-semibold">
          <span className="text-[var(--accent)]">▰</span> Admin
        </Link>
        <span className="text-[11.5px] text-[var(--muted)]">{me.email}</span>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          <Link href="/map" className="mwm-btn">Open Map</Link>
          <button type="button" onClick={logout} className="mwm-btn">
            Sign out
          </button>
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
        {tab === "overview" && <Overview />}
        {tab === "links" && <Links />}
        {tab === "buildings" && <Buildings />}
        {tab === "jobs" && <Jobs busy={busy} setBusy={setBusy} />}
        {tab === "users" && <Users />}
        {tab === "settings" && <Settings />}
        {tab === "audit" && <Audit />}
      </main>
    </div>
  );
}

function usePoll<T>(fn: () => Promise<T>, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await fn());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [fn]);
  useEffect(() => {
    void reload();
    const iv = setInterval(() => void reload(), ms);
    return () => clearInterval(iv);
  }, [reload, ms]);
  return { data, err, reload };
}

/* ------------------------------- overview ------------------------------- */

type Stats = {
  buildings: number;
  photos: number;
  videos: number;
  sessions: number;
  links: number;
  users: number;
  buildingsByStatus: Record<string, number>;
  jobsByStatus: Record<string, number>;
  activity: { action: string; entity: string | null; createdAt: string; actorId: string | null }[];
};

function Overview() {
  const { data: s } = usePoll(async () => {
    const r = await fetch("/api/stats");
    if (!r.ok) throw new Error("stats unavailable");
    return (await r.json()) as Stats;
  }, 6000);
  if (!s) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const jobs = s.jobsByStatus;
  const byStatus = s.buildingsByStatus;
  const cards: [string, number | string][] = [
    ["Buildings", s.buildings],
    ["Needs review", byStatus.needs_review ?? 0],
    ["Approved", byStatus.approved ?? 0],
    ["Photos", s.photos],
    ["Videos", s.videos],
    ["Sessions", s.sessions],
    ["Active links", s.links],
    ["Users", s.users],
    ["Jobs pending", jobs.pending ?? 0],
    ["Jobs running", jobs.running ?? 0],
    ["Jobs completed", jobs.completed ?? 0],
    ["Jobs failed", jobs.failed ?? 0],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, n]) => (
          <div key={label} className="mwm-panel p-3">
            <p className="font-display text-xl font-semibold tabular">{String(n)}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{label}</p>
          </div>
        ))}
      </div>
      <h3 className="mt-6 font-display text-[13px] font-semibold">Recent activity</h3>
      <ul className="mwm-panel mt-2 divide-y divide-[var(--line)]">
        {s.activity.length === 0 && (
          <li className="px-3 py-3 text-[12px] text-[var(--muted)]">
            No activity yet. Create a mapping link and share it.
          </li>
        )}
        {s.activity.map((a, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2 text-[12px]">
            <span className="font-medium">{a.action}</span>
            {a.entity && <span className="text-[var(--muted)]">{a.entity}</span>}
            <span className="ml-auto text-[11px] text-[var(--muted)] tabular">
              {new Date(a.createdAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------- links -------------------------------- */

type LinkRow = {
  id: string;
  token: string;
  label: string | null;
  scope: string;
  allowVideo: boolean;
  oneTime: boolean;
  maxSubmissions: number | null;
  usedSubmissions: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function Links() {
  const { data, reload } = usePoll(async () => {
    const r = await fetch("/api/links");
    if (!r.ok) throw new Error("forbidden");
    return ((await r.json()).links as LinkRow[]);
  }, 6000);

  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"global" | "area" | "location">("global");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("250");
  const [maxSub, setMaxSub] = useState("");
  const [oneTime, setOneTime] = useState(false);
  const [video, setVideo] = useState(true);
  const [expires, setExpires] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    const r = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        scope,
        centerLat: lat ? Number(lat) : undefined,
        centerLng: lng ? Number(lng) : undefined,
        radiusM: Number(radius) || 250,
        maxSubmissions: maxSub ? Number(maxSub) : null,
        oneTime,
        allowVideo: video,
        expiresInDays: expires ? Number(expires) : null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ?? "Create failed");
      return;
    }
    const url = `${window.location.origin}${j.contributePath}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    setMsg(`Link created and copied: ${url}`);
    setLabel("");
    void reload();
  };

  const act = async (id: string, action: string) => {
    await fetch(`/api/links/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    void reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="mwm-panel space-y-2.5 p-3.5">
        <h3 className="font-display text-[13px] font-semibold">Create mapping link</h3>
        <input className="mwm-input" placeholder="Label (e.g. Old Town block)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="mwm-input" value={scope} onChange={(e) => setScope(e.target.value as never)}>
            <option value="global">Any location</option>
            <option value="area">Specific area</option>
            <option value="location">Specific location</option>
          </select>
          <input className="mwm-input" placeholder="Radius m" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
        {scope !== "global" && (
          <div className="grid grid-cols-2 gap-2">
            <input className="mwm-input" placeholder="Center lat (e.g. -6.7935)" value={lat} onChange={(e) => setLat(e.target.value)} />
            <input className="mwm-input" placeholder="Center lng (e.g. 39.212)" value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input className="mwm-input" placeholder="Max submissions (blank = ∞)" type="number" value={maxSub} onChange={(e) => setMaxSub(e.target.value)} />
          <input className="mwm-input" placeholder="Expires in days (blank = ∞)" type="number" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} />
          One-time link
        </label>
        <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
          Allow video capture
        </label>
        <button type="button" className="mwm-primary w-full" onClick={create}>
          Generate link
        </button>
        {msg && <p className="break-all text-[11.5px] text-[var(--accent)]">{msg}</p>}
      </div>

      <div className="mwm-panel overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-[12px]">
          <thead className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Link</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((l) => (
              <tr key={l.id} className="border-b border-[var(--line)]/50">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-mono text-[11.5px] text-[var(--accent)] hover:underline"
                    onClick={() => {
                      const url = `${window.location.origin}/contribute/${l.token}`;
                      void navigator.clipboard?.writeText(url).catch(() => {});
                      setMsg(`Copied: ${url}`);
                    }}
                  >
                    {l.token}
                  </button>
                  <p className="text-[10.5px] text-[var(--muted)]">
                    {l.label ?? "unlabelled"}
                    {l.oneTime && " · one-time"}
                    {!l.allowVideo && " · no video"}
                  </p>
                </td>
                <td className="px-3 py-2 text-[var(--muted)]">{l.scope}</td>
                <td className="px-3 py-2 tabular">
                  {l.usedSubmissions}
                  {l.maxSubmissions != null ? ` / ${l.maxSubmissions}` : ""}
                </td>
                <td className="px-3 py-2 text-[var(--muted)] tabular">
                  {l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "never"}
                </td>
                <td className="px-3 py-2">
                  {l.revokedAt ? (
                    <span className="mwm-badge badge-bad">revoked</span>
                  ) : l.expiresAt && new Date(l.expiresAt) < new Date() ? (
                    <span className="mwm-badge badge-muted">expired</span>
                  ) : (
                    <span className="mwm-badge badge-ok">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {l.revokedAt ? (
                    <button type="button" className="mwm-btn" onClick={() => act(l.id, "restore")}>
                      Restore
                    </button>
                  ) : (
                    <button type="button" className="mwm-btn" onClick={() => act(l.id, "revoke")}>
                      Revoke
                    </button>
                  )}{" "}
                  <button
                    type="button"
                    className="mwm-btn !text-[var(--bad)]"
                    onClick={() => {
                      if (confirm("Delete this link permanently?")) void act(l.id, "delete");
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--muted)]">
                  No links yet — create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- buildings ------------------------------- */

function Buildings() {
  const [filter, setFilter] = useState("");
  const { data } = usePoll(async () => {
    const r = await fetch(`/api/buildings?limit=60&status=${filter}`);
    if (!r.ok) throw new Error("forbidden");
    return ((await r.json()).buildings as Record<string, unknown>[]) ?? [];
  }, 6000);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
        {["", "needs_review", "approved", "rejected", "draft"].map((s) => (
          <button
            key={s}
            type="button"
            className={`mwm-btn ${filter === s ? "mwm-btn-on" : ""}`}
            onClick={() => setFilter(s)}
          >
            {s || "All"}
          </button>
        ))}
      </div>
      <ul className="space-y-1.5">
        {(data ?? []).map((b) => (
          <li key={b.id as string}>
            <Link
              href={`/admin/buildings/${b.id}`}
              className="mwm-panel flex items-center gap-3 px-3 py-2.5 transition-colors hover:border-[var(--accent)]/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-semibold">
                  {(b.name as string) ?? `Building ${(b.id as string).slice(0, 8)}`}
                </p>
                <p className="text-[11px] text-[var(--muted)] tabular">
                  {(b.centerLat as number).toFixed(5)}, {(b.centerLng as number).toFixed(5)}
                </p>
              </div>
              <span className="mwm-badge badge-muted">v{String(b.currentVersion)}</span>
              <span
                className={`mwm-badge ${
                  b.status === "approved"
                    ? "badge-ok"
                    : b.status === "rejected"
                      ? "badge-bad"
                      : "badge-warn"
                }`}
              >
                {String(b.status)}
              </span>
              <span className="text-[11px] text-[var(--muted)]">Review →</span>
            </Link>
          </li>
        ))}
        {data && data.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-[var(--muted)]">
            No buildings match. Captures create buildings automatically.
          </p>
        )}
      </ul>
    </div>
  );
}

/* --------------------------------- jobs --------------------------------- */

function Jobs({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const [logView, setLogView] = useState<string | null>(null);
  const { data, reload } = usePoll(async () => {
    const r = await fetch("/api/jobs");
    if (!r.ok) throw new Error("forbidden");
    return ((await r.json()).jobs as Record<string, unknown>[]) ?? [];
  }, 4000);

  const retry = async (id: string) => {
    setBusy(true);
    await fetch(`/api/jobs/${id}/retry`, { method: "POST" });
    setBusy(false);
    void reload();
  };

  const openLog = async (id: string) => {
    const r = await fetch(`/api/jobs/${id}/logs`);
    const j = await r.json().catch(() => ({}));
    setLogView(j.log || "(no log yet)");
  };

  return (
    <div>
      {logView && (
        <pre className="mwm-panel mb-3 max-h-48 overflow-auto p-3 text-[11px] text-[var(--muted)]">
          {logView}
        </pre>
      )}
      <table className="mwm-panel w-full text-left text-[12px]">
        <thead className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Error</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((j) => (
            <tr key={j.id as string} className="border-b border-[var(--line)]/50">
              <td className="px-3 py-2">{String(j.type)}</td>
              <td className="px-3 py-2">
                <span
                  className={`mwm-badge ${
                    j.status === "completed"
                      ? "badge-ok"
                      : j.status === "failed"
                        ? "badge-bad"
                        : j.status === "running"
                          ? "badge-warn"
                          : "badge-muted"
                  }`}
                >
                  {String(j.status)}
                  {Number(j.retryCount) > 0 ? ` (retry ${j.retryCount})` : ""}
                </span>
              </td>
              <td className="px-3 py-2 text-[var(--muted)] tabular">
                {new Date(j.createdAt as string).toLocaleString()}
              </td>
              <td className="max-w-[16rem] truncate px-3 py-2 text-[var(--muted)]">
                {String(j.error ?? "")}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <button type="button" className="mwm-btn" onClick={() => openLog(j.id as string)}>
                  Log
                </button>{" "}
                {j.status === "failed" && (
                  <button type="button" className="mwm-btn" disabled={busy} onClick={() => retry(j.id as string)}>
                    Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-[var(--muted)]">
                No jobs yet — jobs appear when captures arrive.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- users --------------------------------- */

function Users() {
  const { data, reload } = usePoll(async () => {
    const r = await fetch("/api/users");
    if (!r.ok) throw new Error("forbidden");
    return ((await r.json()).users as { id: string; email: string; name: string; role: string; createdAt: string }[]) ?? [];
  }, 8000);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j.error ?? "Failed");
      return;
    }
    setEmail("");
    setPassword("");
    setName("");
    setErr(null);
    void reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="mwm-panel space-y-2.5 p-3.5">
        <h3 className="font-display text-[13px] font-semibold">Create account</h3>
        <input className="mwm-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="mwm-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mwm-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <select className="mwm-input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">viewer</option>
          <option value="contributor">contributor</option>
          <option value="admin">admin</option>
        </select>
        {err && <p className="text-[11.5px] text-[var(--bad)]">{err}</p>}
        <button type="button" className="mwm-primary w-full" onClick={create}>
          Create
        </button>
      </div>
      <table className="mwm-panel w-full text-left text-[12px]">
        <thead className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((u) => (
            <tr key={u.id} className="border-b border-[var(--line)]/50">
              <td className="px-3 py-2">
                {u.name}
                <p className="text-[10.5px] text-[var(--muted)]">{u.email}</p>
              </td>
              <td className="px-3 py-2">
                <span className={`mwm-badge ${u.role === "admin" ? "badge-warn" : "badge-muted"}`}>{u.role}</span>
              </td>
              <td className="px-3 py-2 text-[var(--muted)] tabular">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- settings ------------------------------- */

function Settings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setSettings(j.settings as Record<string, string>))
      .catch(() => {});
  }, []);
  if (!settings) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSettings({ ...settings, [k]: e.target.value });
  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform_name: settings.platform_name,
        map_visibility: settings.map_visibility,
        gps_max_accuracy_m: Number(settings.gps_max_accuracy_m),
        multi_view_min_captures: Number(settings.multi_view_min_captures),
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <div className="mwm-panel max-w-lg space-y-3 p-4">
      <h3 className="font-display text-[13px] font-semibold">Platform settings</h3>
      <label className="block text-[12px] text-[var(--muted)]">
        Platform name
        <input className="mwm-input mt-1" value={settings.platform_name ?? ""} onChange={set("platform_name")} />
      </label>
      <label className="block text-[12px] text-[var(--muted)]">
        Map visibility
        <select className="mwm-input mt-1" value={settings.map_visibility} onChange={set("map_visibility")}>
          <option value="public">public — anyone can view</option>
          <option value="invite_only">invite_only — signed-in users</option>
          <option value="private">private — signed-in users only, hidden</option>
        </select>
      </label>
      <label className="block text-[12px] text-[var(--muted)]">
        GPS max accuracy (m)
        <input className="mwm-input mt-1" type="number" value={settings.gps_max_accuracy_m ?? 20} onChange={set("gps_max_accuracy_m")} />
        <p className="mt-1 text-[11px]">Captures above this are flagged; above 2× they are rejected.</p>
      </label>
      <label className="block text-[12px] text-[var(--muted)]">
        Multi-view minimum captures
        <input className="mwm-input mt-1" type="number" value={settings.multi_view_min_captures ?? 3} onChange={set("multi_view_min_captures")} />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="mwm-primary" onClick={save}>
          Save
        </button>
        {saved && <span className="text-[12px] text-[var(--ok)]">Saved.</span>}
      </div>
    </div>
  );
}

/* --------------------------------- audit --------------------------------- */

function Audit() {
  const { data } = usePoll(async () => {
    const r = await fetch("/api/audit?limit=150");
    if (!r.ok) throw new Error("forbidden");
    return ((await r.json()).logs as { action: string; entity: string | null; entityId: string | null; createdAt: string; detail: Record<string, unknown> | null }[]) ?? [];
  }, 8000);
  return (
    <table className="mwm-panel w-full text-left text-[12px]">
      <thead className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
        <tr>
          <th className="px-3 py-2">When</th>
          <th className="px-3 py-2">Action</th>
          <th className="px-3 py-2">Entity</th>
          <th className="px-3 py-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).map((a, i) => (
          <tr key={i} className="border-b border-[var(--line)]/50">
            <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)] tabular">
              {new Date(a.createdAt).toLocaleString()}
            </td>
            <td className="px-3 py-2">{a.action}</td>
            <td className="px-3 py-2 text-[var(--muted)]">{a.entity ?? "—"}</td>
            <td className="max-w-[14rem] truncate px-3 py-2 text-[var(--muted)]">
              {a.detail ? JSON.stringify(a.detail) : ""}
            </td>
          </tr>
        ))}
        {data && data.length === 0 && (
          <tr>
            <td colSpan={4} className="px-3 py-4 text-[var(--muted)]">
              No audit entries yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
