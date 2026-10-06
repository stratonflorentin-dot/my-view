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
    <div className="min-h-dvh text-[var(--fg)]">
      <header className="mwm-bar">
        <Link href="/" className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="My View"
            className="h-7 w-7 flex-none rounded-[var(--r-2)] border border-[var(--line-2)] object-cover"
          />
          <span className="font-display text-[13.5px] font-semibold tracking-[-0.01em]">
            My Maps
          </span>
        </Link>

        <span className="hidden h-4 w-px bg-[var(--line-2)] sm:block" />

        <span className="truncate text-[12.5px] text-[var(--muted)]">{me.email}</span>
        {me.role === "admin" && <span className="mwm-badge badge-muted">admin</span>}

        <div className="ml-auto flex items-center gap-1">
          <Link href="/map" className="mwm-btn">Open Map</Link>
          {me.role === "admin" && (
            <>
              <span className="h-4 w-px bg-[var(--line)]" />
              <Link href="/admin" className="mwm-btn">Admin</Link>
            </>
          )}
          <span className="h-4 w-px bg-[var(--line)]" />
          <button type="button" onClick={logout} className="mwm-btn">Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="mwm-eyebrow">Projects</p>
            <h1 className="mt-1 font-display text-base font-semibold tracking-[-0.01em]">
              Your map projects
            </h1>
          </div>
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

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {projects === null && (
            <p className="text-[12.5px] text-[var(--muted-2)]">Loading projects…</p>
          )}
          {projects?.length === 0 && !creating && (
            <div className="mwm-panel p-5 sm:col-span-2">
              <p className="mwm-eyebrow">No data</p>
              <p className="mt-2 text-[13px] text-[var(--fg)]">No projects yet.</p>
              <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
                Create your first map project to start scanning. API keys live inside a map
                project, on its Developers tab.
              </p>
            </div>
          )}
          {projects?.map((p) => (
            <div
              key={p.id}
              className="mwm-panel block p-3.5 transition-colors hover:border-[var(--line-2)]"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-[var(--r-1)] border border-[var(--line)] bg-[var(--bg-3)]">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3 text-[var(--accent)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
                    <path d="M12 22V12M3 7l9 5 9-5" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-display text-[13.5px] font-semibold tracking-[-0.01em]">
                      <Link
                        href={`/dashboard/projects/${p.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {p.name}
                      </Link>
                    </h2>
                    <span className="mwm-badge badge-muted ml-auto flex-none">
                      {p.visibility.replace(/_/g, " ")}
                    </span>
                  </div>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
                      {p.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-2 text-[10.5px] text-[var(--muted-2)]">
                <span className="font-mono uppercase tracking-[0.08em]">{p.access}</span>
                <span className="h-3 w-px bg-[var(--line)]" />
                <span className="font-mono">{new Date(p.createdAt).toLocaleDateString()}</span>
                <Link
                  href={`/dashboard/projects/${p.id}?tab=developers`}
                  className="ml-auto font-medium text-[var(--accent)] hover:underline"
                >
                  API keys →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
