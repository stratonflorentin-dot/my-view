const B = "http://localhost:3111";
let cookie = "";
async function req(path, opts = {}) {
  const r = await fetch(B + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return { status: r.status, body: await r.json().catch(() => null) };
}
(async () => {
  let r = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@test.local", password: "Test-2026-pass", name: "Owner" }),
  });
  console.log("register:", r.status);
  if (r.status >= 400) {
    r = await req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@test.local", password: "Test-2026-pass" }),
    });
    console.log("login:", r.status);
  }
  r = await req("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "My Dar es Salaam Map", visibility: "private", centerLat: -6.7924, centerLng: 39.2083 }),
  });
  console.log("create project:", r.status, r.body?.project?.id ? "id=" + r.body.project.id.slice(0, 8) : JSON.stringify(r.body));
  const pid = r.body?.project?.id;
  r = await req("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: pid, label: "Kariakoo block scan", scope: "area", fenceType: "circle", centerLat: -6.7924, centerLng: 39.2083, radiusM: 500, requireGps: true, requireApproval: true }),
  });
  console.log("create scan link:", r.status, r.body?.scanPath ?? JSON.stringify(r.body));
  const token = r.body?.link?.token;
  const v = await fetch(B + "/api/contribute/validate?token=" + token).then((x) => x.json());
  console.log("public validate:", v.ok, v.link?.scope, "fence=" + v.link?.fenceType);
  const s = await fetch(B + "/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name: "Friend" }),
  });
  console.log("start session:", s.status);
  const sj = await s.json();
  let cap = await fetch(B + "/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ sessionId: sj.sessionId, kind: "photo", gps: { lat: -6.70, lng: 39.30, hAccuracy: 5, source: "gps" } }),
  });
  console.log("capture outside fence:", cap.status, (await cap.json()).error);
  cap = await fetch(B + "/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ sessionId: sj.sessionId, kind: "photo", gps: { lat: -6.7924, lng: 39.2083, hAccuracy: 5, source: "gps" } }),
  });
  console.log("capture inside fence (no file):", cap.status, (await cap.json()).error);
  const sub = await req("/api/submissions?projectId=" + pid + "&status=pending");
  console.log("submissions queue:", sub.status, sub.body?.submissions?.length ?? 0, "pending");
  // v1 API must reject without a key
  const nov = await fetch(B + "/api/v1/maps");
  console.log("v1 without key:", nov.status, (await nov.json()).error);
  // unauthenticated project access must be rejected
  const anon = await fetch(B + "/api/projects/" + pid);
  console.log("anon project access:", anon.status);
})().catch((e) => {
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
});
