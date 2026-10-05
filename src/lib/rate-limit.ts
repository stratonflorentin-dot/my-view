import "server-only";
import { NextResponse } from "next/server";

/**
 * Minimal in-memory sliding-window rate limiter (per key).
 * Suitable for a single-node deployment; swap for Redis in multi-node setups.
 */
const buckets = new Map<string, number[]>();

const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  auth: { limit: 10, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
  api: { limit: 120, windowMs: 60_000 },
};

export function rateLimit(
  req: Request,
  kind: keyof typeof LIMITS,
): NextResponse | null {
  const spec = LIMITS[kind];
  const key = `${kind}:${req.headers.get("x-forwarded-for") ?? "local"}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < spec.windowMs);
  if (hits.length >= spec.limit) {
    buckets.set(key, hits);
    return NextResponse.json(
      { error: "Too many requests, slow down." },
      { status: 429 },
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= spec.windowMs)) buckets.delete(k);
    }
  }
  return null;
}
