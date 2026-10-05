"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Me = { sub: string; email: string; name: string; role: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  centerLat: number | null;
  centerLng: number | null;
  access: string;
  createdAt: string;
};

export default function ProjectsDashboard({ me }: { me: Me }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [center, setCenter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/projects");
    if (r.ok) {
      const j = await r.json();
      setProjects(j.projects);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const [lat, lng] = center
        .split(",")
        .map((s) => Number(s.trim()));
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          visibility,
          centerLat: Number.isFinite(lat) ? lat : undefined,
          centerLng: Number.isFinite(lng) ? lng : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not create project");
      setCreating(false);
      setName("");
      setCenter("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)] px-4 py-2.5">
        <Link href="/" className="font-display text-[14px] font-semibold">
          <span className="text-[var(--accent)]">▰</span> My Maps
        </Link>
        <span className="text-[11.5px] text-[var(--muted)]">{me.email}</span>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          <Link href="/map" className="mwm-btn">Open Map</Link>
          {me.role === "admin" && <Link href="/admin" className="mwm-btn">Admin</Link>}
          <button type="button" onClick={logout} className="mwm-btn">Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold">Your map projects</h1>
          <button type="button" className="mwm-btn mwm-btn-on" onClick={() => setCreating(true)}>
            + New project
          </button>
        </div>

        {creating && (
          <div className="mwm-panel mt-4 space-y-3 p-4">
            <h2 className="font-display text-[14px] font-semibold">Create a map project</h2>
            <div>
              <label className="text-[12px] text-[var(--muted)]">Project name</label>
              <input
                className="mwm-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Dar es Salaam Map"
                maxLength={160}
              />
            </div>
            <div>
              <label className="text-[12px] text-[var(--muted)]">Visibility</label>
              <select
                className="mwm-input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="private">Private — only you and invited members</option>
                <option value="invitation_only">Invitation only — link holders can view</option>
                <option value="shared">Shared — anyone with the link can view</option>
                <option value="public">Public — listed and viewable</option>
                <option value="api_only">API only — accessible through the API</option>
              </select>
            </div>
            <div>
              <label className="text-[12px] text-[var(--muted)]">
                Center (lat, lng — optional)
              </label>
              <input
                className="mwm-input"
                value={center}
                onChange={(e) => setCenter(e.target.value)}
                placeholder="-6.7924, 39.2083"
              />
            </div>
            {error && <p className="text-[12px] text-[var(--bad)]">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="mwm-primary" disabled={!name.trim() || busy} onClick={create}>
                {busy ? "Creating…" : "Create project"}
              </button>
              <button type="button" className="mwm-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {projects === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}
          {projects?.length === 0 && !creating && (
            <p className="text-sm text-[var(--muted)]">
              No projects yet — create your first map project to start scanning.
            </p>
          )}
          {projects?.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="mwm-panel block p-4 transition hover:border-[var(--accent)]">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-[14.5px] font-semibold">{p.name}</h2>
                <span className="mwm-badge badge-muted ml-auto">{p.visibility.replace("_", " ")}</span>
              </div>
              {p.description && (
                <p className="mt-1 line-clamp-2 text-[12.5px] text-[var(--muted)]">{p.description}</p>
              )}
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Access: {p.access} · created {new Date(p.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
