const B = process.env.BASE_URL || "http://localhost:3111";
const BYPASS = process.env.BYPASS_TOKEN
  ? { "x-vercel-protection-bypass": process.env.BYPASS_TOKEN }
  : {};
let cookie = "";
const req = async (p, o = {}) => {
  const r = await fetch(B + p, {
    ...o,
    headers: { ...BYPASS, ...(o.headers || {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: r.status, body };
};

(async () => {
  let r = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@test.local", password: "Test-2026-pass" }),
  });
  console.log("login:", r.status);
  const me = await req("/api/auth/me");
  console.log("me:", me.status, me.body?.user?.role, me.body?.user?.email);

  r = await req("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "API Key Test " + Date.now(), visibility: "private" }),
  });
  const pid = r.body?.project?.id;
  console.log("project:", r.status, pid);

  r = await req(`/api/keys?projectId=${pid}`);
  console.log("list keys:", r.status, r.body?.keys ? `count=${r.body.keys.length}` : JSON.stringify(r.body).slice(0, 200));

  r = await req("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: pid,
      name: "test key",
      type: "secret",
      scopes: ["maps:read", "buildings:read"],
    }),
  });
  console.log("create key:", r.status, JSON.stringify(r.body).slice(0, 400));
})().catch((e) => console.error("FAIL:", e.message));
