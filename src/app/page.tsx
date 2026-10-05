import Link from "next/link";
import MapLoader from "@/components/map/MapLoader";
import { getSettings } from "@/lib/config";
import { getSession } from "@/lib/auth";

const STEPS = [
  {
    n: "01",
    title: "Create a mapping link",
    body: "Generate a secure, revocable link from your dashboard — one-time, timed, or location-scoped, with per-link permissions.",
  },
  {
    n: "02",
    title: "Your phone captures",
    body: "The contributor opens the link, allows location, and a guided workflow leads them around the building — 8 compass arcs, quality and GPS checks on every shot.",
  },
  {
    n: "03",
    title: "The pipeline processes",
    body: "Uploads are validated, EXIF + quality analysed, duplicates detected, captures grouped per building, and a processing job runs asynchronously.",
  },
  {
    n: "04",
    title: "Your 3D map grows",
    body: "Estimated geometry appears immediately and is labelled as such. More overlapping photographs upgrade it — a photogrammetry or neural engine can be plugged in for full mesh reconstruction.",
  },
];

export default async function Landing() {
  const settings = await getSettings();
  const user = await getSession();
  const reconConfigured = Boolean(process.env.RECON_API_URL);

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/40">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
              <path d="M12 22V12M3 7l9 5 9-5" />
            </svg>
          </span>
          <span className="font-display text-[15px] font-semibold tracking-wide">
            {settings.platform_name}
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          <Link href="/map" className="mwm-btn">Explore Map</Link>
          <Link href="/api/docs" className="mwm-btn">API</Link>
          {user ? (
            <>
              <Link href={user.role === "admin" ? "/admin" : "/map"} className="mwm-btn">{user.name}</Link>
              {user.role === "admin" && <Link href="/admin" className="mwm-btn-on mwm-btn">Dashboard</Link>}
            </>
          ) : (
            <>
              <Link href="/login" className="mwm-btn">Sign in</Link>
              <Link href="/register" className="mwm-btn mwm-btn-on">Get started</Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-10 pt-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="mwm-badge badge-muted mb-4">
            Private 3D mapping platform
            {!reconConfigured && (
              <span className="ml-1 text-[var(--muted)]">· estimation engines active · photogrammetry pluggable</span>
            )}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            Build your own
            <span className="text-[var(--accent)]"> living 3D map</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
            Invite people around a location. They photograph it with their
            phone — GPS, quality and overlap checked at every step. The
            pipeline reconstructs the geography and your map grows, one
            verified building at a time.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link
              href={user?.role === "admin" ? "/admin" : "/login"}
              className="mwm-primary"
            >
              Create Mapping Link
            </Link>
            <Link href="/map" className="mwm-ghost">
              Explore Map
            </Link>
            <Link href="/login" className="mwm-ghost">
              Contribute
            </Link>
          </div>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3 text-center">
            {[
              ["8-arc", "guided capture"],
              ["±3 m", "GPS graded, never faked"],
              ["0 → 3D", "estimate → photogrammetry"],
            ].map(([a, b]) => (
              <div key={a} className="mwm-panel px-2 py-3">
                <p className="font-display text-lg font-semibold text-[var(--accent)] tabular">{a}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">{b}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mwm-panel relative h-[380px] overflow-hidden p-1.5 lg:h-[440px]">
          <MapLoader preview />
          <p className="absolute bottom-3 left-3 z-10 rounded-md bg-[var(--panel)] px-2 py-1 text-[10.5px] text-[var(--muted)] ring-1 ring-[var(--line)]">
            Live platform map — satellite · 3D buildings · coverage
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="font-display text-xl font-semibold">How it works</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="mwm-panel p-4">
              <p className="font-display text-xs font-semibold text-[var(--accent)] tabular">{s.n}</p>
              <h3 className="mt-2 font-display text-[14.5px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-[12.5px] leading-relaxed text-[var(--muted)]">
          Honest by design: a single photograph produces an{" "}
          <span className="text-[var(--warn)]">estimated</span> representation
          with a documented confidence score — never a fake scan. Multi-view
          captures upgrade it, and the reconstruction layer is an engine
          registry (<code className="text-[var(--fg)]">ReconstructionEngine</code>,{" "}
          <code className="text-[var(--fg)]">BuildingDetectionEngine</code>) so
          real photogrammetry, neural or gaussian-splatting services can be
          attached later without changing the product.
        </p>
      </section>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-5 text-[11.5px] text-[var(--muted)]">
          <span>{settings.platform_name} — private mapping platform</span>
          <span className="ml-auto flex gap-4">
            <Link href="/api/openapi.json" className="hover:text-[var(--fg)]">OpenAPI</Link>
            <Link href="/api/docs" className="hover:text-[var(--fg)]">API docs</Link>
            <Link href="/login" className="hover:text-[var(--fg)]">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
