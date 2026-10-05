import { describe, expect, it } from "vitest";
import {
  arcCoverage,
  arcOf,
  convexHull,
  haversineM,
  polygonAreaM2,
  regularPolygon,
  shrinkTowardCentroid,
} from "@/lib/geo";
import { gradeGps, inScope, validateFix } from "@/lib/gps";
import { computeConfidence } from "@/lib/confidence";
import { checkLink, generateToken } from "@/lib/links";

describe("geo", () => {
  it("haversine: 0.01° latitude ≈ 1105 m", () => {
    const d = haversineM(0, 0, 0.01, 0);
    expect(d).toBeGreaterThan(1090);
    expect(d).toBeLessThan(1120);
  });

  it("haversine: 1° longitude at equator ≈ 111 km", () => {
    const d = haversineM(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111500);
  });

  it("convex hull of a square-ish cluster has 4 corners and positive area", () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0.01, lng: 0.01 },
      { lat: 0.01, lng: 0 },
      { lat: 0.005, lng: 0.005 }, // interior point must be excluded
    ];
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    expect(polygonAreaM2(hull)).toBeGreaterThan(1e5); // ~110m × 110m
  });

  it("shrinkTowardCentroid reduces area", () => {
    const poly = regularPolygon({ lat: 0, lng: 0 }, 10, 8);
    const shrunk = shrinkTowardCentroid(poly, 0.5);
    expect(polygonAreaM2(shrunk)).toBeLessThan(polygonAreaM2(poly) / 2);
  });

  it("arcOf maps headings to compass octants", () => {
    expect(arcOf(0)).toBe(0);
    expect(arcOf(44)).toBe(0);
    expect(arcOf(45)).toBe(1);
    expect(arcOf(180)).toBe(4);
    expect(arcOf(359)).toBe(7);
    expect(arcOf(null)).toBeNull();
  });

  it("arcCoverage counts distinct arcs", () => {
    const c = arcCoverage([0, 10, 90, 180, 270]);
    expect(c.distinctArcs).toBe(4);
    expect(c.covered).toEqual([0, 2, 4, 6]);
    expect(arcCoverage([null, null]).distinctArcs).toBe(0);
  });
});

describe("gps validation", () => {
  it("grades accuracy honestly", () => {
    expect(gradeGps(2).level).toBe("excellent");
    expect(gradeGps(8).level).toBe("good");
    expect(gradeGps(15).level).toBe("acceptable");
    expect(gradeGps(30).accepted).toBe(false);
    expect(gradeGps(null).accepted).toBe(false);
  });

  it("rejects invalid coordinates", () => {
    expect(validateFix({ lat: 91, lng: 0 }).ok).toBe(false);
    expect(validateFix({ lat: -6.8, lng: 39.2 }, 20).ok).toBe(true);
  });

  it("enforces geographic scope", () => {
    const scope = {
      scope: "location" as const,
      centerLat: 0,
      centerLng: 0,
      radiusM: 100,
    };
    expect(inScope({ lat: 0, lng: 0.0001 }, scope, haversineM)).toBe(true);
    expect(inScope({ lat: 0.01, lng: 0 }, scope, haversineM)).toBe(false);
    expect(inScope({ lat: 10, lng: 10 }, { ...scope, scope: "global" }, haversineM)).toBe(
      true,
    );
  });
});

describe("confidence", () => {
  it("caps single-photo estimates at 0.4", () => {
    const c = computeConfidence({
      reconstructionType: "estimated_single_image",
      distinctArcs: 1,
      meanSharpness: 900,
      meanGpsAccuracyM: 1,
      overlapRatio: 1,
      captureCount: 1,
    });
    expect(c).toBeLessThanOrEqual(0.4);
  });

  it("rewards more view coverage", () => {
    const low = computeConfidence({
      reconstructionType: "estimated_multi_view",
      distinctArcs: 2,
      meanSharpness: 300,
      meanGpsAccuracyM: 10,
      overlapRatio: 0.5,
      captureCount: 3,
    });
    const high = computeConfidence({
      reconstructionType: "estimated_multi_view",
      distinctArcs: 8,
      meanSharpness: 300,
      meanGpsAccuracyM: 10,
      overlapRatio: 0.5,
      captureCount: 8,
    });
    expect(high).toBeGreaterThan(low);
  });

  it("never exceeds 0.9", () => {
    const c = computeConfidence({
      reconstructionType: "photogrammetry",
      distinctArcs: 8,
      meanSharpness: 5000,
      meanGpsAccuracyM: 1,
      overlapRatio: 1,
      captureCount: 20,
    });
    expect(c).toBeLessThanOrEqual(0.9);
  });
});

describe("contributor links", () => {
  const base = {
    id: "demo-link-1",
    projectId: null,
    token: "KX7M2Q4V9R",
    label: "demo",
    scope: "global" as const,
    fenceType: "circle" as const,
    polygon: null,
    centerLat: null,
    centerLng: null,
    radiusM: 250,
    requireLogin: false,
    requireGps: true,
    minGpsAccuracyM: null,
    allowPhotos: true,
    allowVideo: true,
    allowBuildingScan: true,
    allowAreaScan: false,
    requireApproval: true,
    autoPublish: false,
    formId: null,
    maxSubmissions: null,
    usedSubmissions: 0,
    oneTime: false,
    usedSessionId: null,
    expiresAt: null,
    revokedAt: null,
    createdBy: null,
    createdAt: new Date(),
  };

  it("generates unambiguous 10-char tokens", () => {
    const t = generateToken();
    expect(t).toHaveLength(10);
    expect(t).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    expect(new Set(Array.from({ length: 50 }, () => generateToken())).size).toBe(
      50,
    );
  });

  it("accepts a healthy link", () => {
    expect(checkLink(base).ok).toBe(true);
  });

  it("rejects revoked / expired / exhausted links", () => {
    expect(checkLink({ ...base, revokedAt: new Date() }).ok).toBe(false);
    expect(checkLink({ ...base, expiresAt: new Date(Date.now() - 1000) }).ok).toBe(
      false,
    );
    expect(
      checkLink({ ...base, maxSubmissions: 2, usedSubmissions: 2 }).ok,
    ).toBe(false);
  });

  it("enforces one-time usage", () => {
    const used = { ...base, oneTime: true, usedSessionId: "other-session" };
    expect(checkLink(used).ok).toBe(false);
    // counting as use (starting the session itself) is allowed once
    expect(checkLink(used, { countingAsUse: true }).ok).toBe(true);
  });
});

import { describe as d2, it as it2, expect as e2, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { signSession, verifySession } from "@/lib/auth";

d2("auth session", () => {
  it2("signs and verifies a session token round-trip", async () => {
    const token = await signSession({
      sub: "u-1",
      email: "a@b.c",
      name: "A",
      role: "admin",
    });
    expect(token.split(".")).toHaveLength(3);
    const v = await verifySession(token);
    e2(v).toMatchObject({ sub: "u-1", email: "a@b.c", role: "admin" });
  });

  it2("rejects a tampered token", async () => {
    const token = await signSession({
      sub: "u-1",
      email: "a@b.c",
      name: "A",
      role: "viewer",
    });
    const bad = token.slice(0, -2) + "xx";
    e2(await verifySession(bad)).toBeNull();
  });
});

import { inFence, pointInRing, fenceFromLink, OUTSIDE_FENCE_MESSAGE } from "@/lib/fence";
import { validateFormData } from "@/lib/forms";
import { signPayload } from "@/lib/webhooks";
import { hashSecret, extractKey, generateApiKey } from "@/lib/apiKeys";

d2("geo-fences", () => {
  it2("accepts points inside a circle fence", () => {
    const f = fenceFromLink({
      fenceType: "circle",
      centerLat: -6.7924,
      centerLng: 39.2083,
      radiusM: 500,
      polygon: null,
      scope: "area",
    });
    e2(inFence({ lat: -6.7924, lng: 39.2083 }, f!)).toBe(true);
    e2(inFence({ lat: -6.70, lng: 39.30 }, f!)).toBe(false);
  });

  it2("rectangle fence bounds-checks", () => {
    const f = fenceFromLink({
      fenceType: "rectangle",
      centerLat: null,
      centerLng: null,
      radiusM: 0,
      polygon: [39.19, -6.81, 39.22, -6.78],
      scope: "area",
    });
    e2(inFence({ lat: -6.79, lng: 39.20 }, f!)).toBe(true);
    e2(inFence({ lat: -6.70, lng: 39.20 }, f!)).toBe(false);
  });

  it2("polygon fence uses ray casting", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    e2(pointInRing(0.5, 0.5, ring)).toBe(true);
    e2(pointInRing(1.5, 0.5, ring)).toBe(false);
  });

  it2("global scope has no fence", () => {
    e2(
      fenceFromLink({
        fenceType: "circle",
        centerLat: 0,
        centerLng: 0,
        radiusM: 10,
        polygon: null,
        scope: "global",
      }),
    ).toBeNull();
  });
});

d2("forms", () => {
  it2("enforces required fields", () => {
    const v = validateFormData([{ key: "price", label: "Price", type: "number", required: true }], {});
    e2(v.ok).toBe(false);
  });

  it2("validates numbers and selects", () => {
    const v = validateFormData(
      [
        { key: "bedrooms", label: "Bedrooms", type: "number" },
        { key: "crop", label: "Crop", type: "select", options: ["maize", "rice"] },
      ],
      { bedrooms: "3", crop: "maize" },
    );
    e2(v.ok).toBe(true);
    if (v.ok) e2(v.values.bedrooms).toBe(3);
    const bad = validateFormData(
      [{ key: "crop", label: "Crop", type: "select", options: ["maize", "rice"] }],
      { crop: "wheat" },
    );
    e2(bad.ok).toBe(false);
  });
});

d2("webhook signing", () => {
  it2("produces a stable HMAC signature", () => {
    const s1 = signPayload("whsec_test", '{"a":1}', 1700000000);
    const s2 = signPayload("whsec_test", '{"a":1}', 1700000000);
    e2(s1).toBe(s2);
    e2(s1).toHaveLength(64);
    const s3 = signPayload("whsec_other", '{"a":1}', 1700000000);
    e2(s1).not.toBe(s3);
  });
});

d2("api keys", () => {
  it2("hashes secrets deterministically", () => {
    e2(hashSecret("mk_secret_abc")).toBe(hashSecret("mk_secret_abc"));
    e2(hashSecret("mk_secret_abc")).not.toBe(hashSecret("mk_secret_abd"));
  });

  it2("extracts bearer keys from headers", () => {
    const req = new Request("https://x.local/api", {
      headers: { authorization: "Bearer mk_secret_abc" },
    });
    e2(extractKey(req)).toBe("mk_secret_abc");
    const req2 = new Request("https://x.local/api", {
      headers: { "x-api-key": "mk_public_123" },
    });
    e2(extractKey(req2)).toBe("mk_public_123");
  });

  it2("generates correctly prefixed keys", () => {
    const k = generateApiKey("p-1");
    e2(k.publicKey.startsWith("mk_public_")).toBe(true);
    e2(k.secret.startsWith("mk_secret_")).toBe(true);
  });
});
