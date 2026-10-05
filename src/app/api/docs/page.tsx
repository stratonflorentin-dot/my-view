import Link from "next/link";

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/api/auth/login", "Sign in (email, password) — sets httpOnly session cookie"],
  ["POST", "/api/auth/register", "Register a viewer account"],
  ["POST", "/api/auth/logout", "Sign out"],
  ["GET", "/api/auth/me", "Current session"],
  ["GET", "/api/links", "List contributor links (admin)"],
  ["POST", "/api/links", "Create contributor link (admin): scope, radius, video, one-time, max submissions, expiry"],
  ["POST", "/api/links/{id}", "revoke | restore | delete (admin)"],
  ["GET", "/api/contribute/validate", "Validate a mapping link (public, token query param) — returns state + resumable session"],
  ["POST", "/api/sessions", "Start/resume a capture session (link re-validated server-side)"],
  ["POST", "/api/captures", "Upload capture: base64 photo/video + GPS. Graded GPS, scope + permission checks, magic-byte validation, processing job enqueued"],
  ["GET", "/api/captures/{id}", "Capture status (received → processed / rejected)"],
  ["GET", "/api/files/{key}", "Signed object download (?exp=&sig= HMAC)"],
  ["GET", "/api/map/features", "Viewport GeoJSON: ?bbox=minLng,minLat,maxLng,maxLat&kinds=buildings,captures,coverage"],
  ["GET", "/api/buildings", "List/search buildings (?q=&status=&limit=&offset=)"],
  ["GET", "/api/buildings/{id}", "Dossier: versions, captures (+signed URLs), sessions, GPS"],
  ["POST", "/api/buildings/{id}/actions", "approve | reject | reprocess | request_imagery | rename | delete (admin)"],
  ["GET", "/api/jobs", "Processing queue (admin)"],
  ["POST", "/api/jobs/{id}/retry", "Retry a failed job (admin)"],
  ["GET", "/api/jobs/{id}/logs", "Job processing log (admin)"],
  ["GET", "/api/stats", "Dashboard statistics (admin)"],
  ["GET", "/api/users", "List accounts (admin)"],
  ["POST", "/api/users", "Create account with role (admin)"],
  ["GET", "/api/settings", "Platform settings (authenticated)"],
  ["PUT", "/api/settings", "Update name / visibility / thresholds (admin)"],
  ["GET", "/api/audit", "Audit trail (admin)"],
  ["GET", "/api/search", "In-platform search: name, id, coordinate prefix"],
  ["GET", "/api/openapi.json", "OpenAPI 3.1 document"],
];

export default function ApiDocsPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-4xl px-5 py-10">
        <Link href="/" className="mwm-btn">← Back</Link>
        <h1 className="mt-4 font-display text-2xl font-semibold">API reference</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[var(--muted)]">
          REST + JSON. Admin endpoints require the session cookie of an admin
          account. Contributor endpoints are token-based and need no account —
          every permission is re-validated server-side on each request. The
          full machine-readable spec is at{" "}
          <a className="text-[var(--accent)]" href="/api/openapi.json">
            /api/openapi.json
          </a>
          .
        </p>
        <div className="mwm-panel mt-6 overflow-hidden">
          <table className="w-full text-left text-[12.5px]">
            <tbody>
              {ENDPOINTS.map(([m, p, d]) => (
                <tr key={m + p} className="border-b border-[var(--line)]/60 last:border-0">
                  <td className="w-16 px-3 py-2.5">
                    <span
                      className={`mwm-badge ${
                        m === "GET" ? "badge-ok" : "badge-warn"
                      }`}
                    >
                      {m}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-[12px] text-[var(--accent)]">{p}</td>
                  <td className="px-3 py-2.5 text-[var(--muted)]">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="mt-8 font-display text-lg font-semibold">Integration notes</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-[var(--muted)]">
          <li>
            <span className="text-[var(--fg)]">Fleet / logistics platforms:</span> poll{" "}
            <code>/api/map/features</code> for the current viewport, or{" "}
            <code>/api/buildings</code> for catalog data.
          </li>
          <li>
            <span className="text-[var(--fg)]">GIS systems:</span> all geometry is GeoJSON
            (WGS84); production deployments can expose PostGIS ST_ queries
            (see <code>docs/DATABASE.md</code>).
          </li>
          <li>
            <span className="text-[var(--fg)]">Reconstruction engines:</span> implement the
            documented HTTP contract and set <code>RECON_API_URL</code> —
            the pipeline picks it up automatically (see{" "}
            <code>docs/3D_RECONSTRUCTION.md</code>).
          </li>
          <li>
            <span className="text-[var(--fg)]">Security:</span> rate limiting on auth/upload,
            signed file URLs, server-side scope + permission enforcement,
            audit logging of every admin action.
          </li>
        </ul>
      </div>
    </div>
  );
}
