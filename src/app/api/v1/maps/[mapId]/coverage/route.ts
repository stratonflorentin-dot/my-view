import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { captures } from "@/db/schema";
import { requireKey, isResponse, v1Error, assertProject } from "@/lib/v1";

/**
 * GET /api/v1/maps/{mapId}/coverage — coverage cells describing how well
 * the area is mapped: none / low / partial / good / high 3D coverage.
 */
const CELL = 0.004; // ~440 m grid, mirrors the internal map layer

export async function GET(
  req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const ctx = await requireKey(req, "maps:read");
  if (isResponse(ctx)) return ctx;
  const { mapId } = await params;
  const denied = assertProject(ctx, mapId);
  if (denied) return denied;

  const rows = await db
    .select({ lat: captures.gpsLat, lng: captures.gpsLng })
    .from(captures)
    .where(and(ne(captures.status, "rejected"), sql`${captures.gpsLat} IS NOT NULL`))
    .limit(20000);
  const grid = new Map<string, { lat: number; lng: number; count: number }>();
  for (const c of rows) {
    if (c.lat == null || c.lng == null) continue;
    const k = `${Math.floor(c.lng / CELL)}:${Math.floor(c.lat / CELL)}`;
    const cell = grid.get(k) ?? {
      lat: (Math.floor(c.lat / CELL) + 0.5) * CELL,
      lng: (Math.floor(c.lng / CELL) + 0.5) * CELL,
      count: 0,
    };
    cell.count++;
    grid.set(k, cell);
  }
  const data = [...grid.values()].map((cell) => {
    const tier =
      cell.count >= 11 ? "high" : cell.count >= 6 ? "good" : cell.count >= 3 ? "partial" : "low";
    return { lat: cell.lat, lng: cell.lng, captureCount: cell.count, tier };
  });
  return NextResponse.json({ data, meta: { cells: data.length, gridDegrees: CELL } });
}
