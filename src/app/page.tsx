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
    <div className="min-h-dvh text-[var(--fg)]">
      {/* Nav */}
      <header className="border-b border-[var(--line)] bg-[var(--bg-2)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="My View"
              className="h-8 w-8 flex-none rounded-[var(--r-2)] border border-[var(--line-2)] object-cover"
            />
            <span className="font-display text-[13.5px] font-semibold tracking-[-0.01em]">
              {settings.platform_name}
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <Link href="/map" className="mwm-btn">Explore Map</Link>
            <Link href="/api/docs" className="mwm-btn">API</Link>
            <span className="mx-1 hidden h-4 w-px bg-[var(--line)] sm:block" />
            {user ? (
              <>
                <Link href={user.role === "admin" ? "/admin" : "/map"} className="mwm-btn">
                  {user.name}
                </Link>
                {user.role === "admin" && (
                  <Link href="/admin" className="mwm-btn mwm-btn-on">Admin</Link>
                )}
              </>
            ) : (
              <>
                <Link href="/login" className="mwm-btn">Sign in</Link>
                <Link href="/register" className="mwm-btn mwm-btn-on">Get started</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-12 pt-10 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="mwm-eyebrow">
            Private 3D mapping platform
            {!reconConfigured && <span className="text-[var(--muted-2)]"> · estimation engines active · photogrammetry pluggable</span>}
          </p>
          <h1 className="mt-3 font-display text-[30px] font-semibold leading-[1.14] tracking-[-0.02em] sm:text-[38px]">
            Build your own
            <br />
            <span className="text-[var(--accent)]">3D map of any place</span>
          </h1>
          <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-[var(--muted)]">
            Invite people around a location. They photograph it with their
            phone — GPS, quality and overlap checked at every step. The
            pipeline reconstructs the geography and your map grows, one
            verified building at a time.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={user?.role === "admin" ? "/admin" : "/login"}
              className="mwm-primary"
            >
              Create mapping link
            </Link>
            <Link href="/map" className="mwm-ghost">
              Explore map
            </Link>
            <Link href="/login" className="mwm-ghost">
              Contribute
            </Link>
          </div>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-2.5">
            {[
              ["8-arc", "Guided capture"],
              ["±3 m", "GPS graded"],
              ["0 → 3D", "Estimate → mesh"],
            ].map(([a, b]) => (
              <div key={a} className="mwm-panel px-3 py-2.5">
                <p className="mwm-metric text-[15px] text-[var(--fg)]">{a}</p>
                <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.08em] text-[var(--muted-2)]">
                  {b}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="mwm-panel relative h-[380px] overflow-hidden p-1.5 lg:h-[440px]">
          <MapLoader preview />
          <p className="absolute bottom-3 left-3 z-10 rounded-[var(--r-1)] border border-[var(--line)] bg-[var(--panel)]/95 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--muted)] backdrop-blur">
            Live map · satellite · 3D buildings · coverage
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <p className="mwm-eyebrow">Workflow</p>
        <h2 className="mt-1 font-display text-[17px] font-semibold tracking-[-0.01em]">
          How it works
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="mwm-panel p-4">
              <p className="mwm-metric text-[11px] text-[var(--muted-2)]">{s.n}</p>
              <h3 className="mt-2 font-display text-[13.5px] font-semibold tracking-[-0.01em]">
                {s.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mwm-panel mt-3 p-4">
          <p className="mwm-eyebrow">Data integrity</p>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-[var(--muted)]">
            A single photograph produces an{" "}
            <span className="text-[var(--warn)]">estimated</span> representation
            with a documented confidence score — never a fake scan. Multi-view
            captures upgrade it, and the reconstruction layer is an engine
            registry (<code className="text-[var(--fg)]">ReconstructionEngine</code>,{" "}
            <code className="text-[var(--fg)]">BuildingDetectionEngine</code>) so
            real photogrammetry, neural or gaussian-splatting services can be
            attached later without changing the product.
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--line)] bg-[var(--bg-2)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-4 text-[11.5px] text-[var(--muted-2)]">
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
