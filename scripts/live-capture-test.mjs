import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.BASE_URL || "http://localhost:3111";
const BYPASS = process.env.BYPASS_TOKEN
  ? { "x-vercel-protection-bypass": process.env.BYPASS_TOKEN }
  : {};

(async () => {
  // 1. Make a real JPEG
  const jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 96, g: 128, b: 72 } },
  })
    .composite([
      { input: Buffer.from(`<svg width="800" height="600"><rect x="120" y="140" width="480" height="320" fill="#c8b89a" stroke="#5a4a32" stroke-width="12"/></svg>`), top: 0, left: 0 },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
  console.log("jpeg bytes:", jpeg.length);

  let cookie = "";
  const req = async (p, o = {}) => {
    const r = await fetch(B + p, {
      ...o,
      headers: { ...BYPASS, ...(o.headers || {}), ...(cookie ? { cookie } : {}) },
    });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // 2. Login as owner
  let r = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@test.local", password: "Test-2026-pass" }),
  });
  console.log("login:", r.status);

  // 3. Project + scan link
  r = await req("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Vercel Live Test Map", visibility: "private", centerLat: -6.7924, centerLng: 39.2083 }),
  });
  const pid = r.body?.project?.id;
  console.log("project:", r.status, pid ? pid.slice(0, 8) : JSON.stringify(r.body));

  r = await req("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: pid, label: "Blob pipeline test", scope: "area", fenceType: "circle", centerLat: -6.7924, centerLng: 39.2083, radiusM: 500, requireGps: true, requireApproval: true }),
  });
  const token = r.body?.link?.token;
  console.log("scan link:", r.status, token);

  // 4. Session + real capture inside fence
  const s = await req("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name: "Friend" }),
  });
  const sessionId = s.body?.sessionId;
  console.log("session:", s.status, sessionId ? "ok" : JSON.stringify(s.body));

  const cap = await req("/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      kind: "photo",
      base64: jpeg.toString("base64"),
      mime: "image/jpeg",
      gps: { lat: -6.7924, lng: 39.2083, hAccuracy: 6, source: "gps" },
    }),
  });
  console.log("capture with real jpeg:", cap.status, cap.status >= 400 ? JSON.stringify(cap.body).slice(0, 200) : "accepted");
  const captureId = cap.body?.captureId;

  // 5. Wait for background processing (sharp + blob on serverless)
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const st = await req("/api/captures/" + captureId);
    if (st.status === 200 && st.body) {
      const c = st.body;
      console.log(`t=${(i + 1) * 5}s status=${c.status} duplicate=${c.duplicate} quality=${c.quality?.sharpness ?? "-"}`);
      if (c.status !== "processing" && c.status !== "received") break;
    } else {
      console.log(`t=${(i + 1) * 5}s status-check:`, st.status, JSON.stringify(st.body).slice(0, 120));
    }
  }

  // 6. Contributor submits the session for review
  const subm = await req("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      kind: "building",
      name: "Test Warehouse A",
      category: "warehouse",
      description: "Live pipeline test submission",
      lat: -6.7924,
      lng: 39.2083,
    }),
  });
  console.log("submit session:", subm.status, subm.status >= 400 ? JSON.stringify(subm.body).slice(0, 200) : "submitted");

  // 7. Review queue should now hold it
  const sub = await req("/api/submissions?projectId=" + pid + "&status=pending");
  console.log("submissions pending:", sub.status, sub.body?.submissions?.length ?? 0);
})().catch((e) => {
  console.error("LIVE FAIL:", e.message);
  process.exit(1);
});
