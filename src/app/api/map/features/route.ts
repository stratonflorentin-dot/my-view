import { NextResponse } from "next/server";
import { and, desc, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions, captures } from "@/db/schema";
import { getSettings } from "@/lib/config";
import { getSession } from "@/lib/auth";

const CELL = 0.004; // ~440 m coverage grid

/**
 * Viewport-scoped GeoJSON for the map. Only objects intersecting the
 * requested bbox are returned — the browser never loads the whole table.
 * (Production with PostGIS: ST_Intersects; here: bbox + center filter.)
 */
export async function GET(req: Request) {
  const settings = await getSettings();
  if (settings.map_visibility !== "public") {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Map requires access" }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const bbox = (url.searchParams.get("bbox") ?? "")
    .split(",")
    .map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox=minLng,minLat,maxLng,maxLat" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const kinds = (url.searchParams.get("kinds") ?? "buildings,captures,coverage")
    .split(",")
    .map((s) => s.trim());

  const out: Record<string, unknown> = {};

  if (kinds.includes("buildings")) {
    const bs = await db
      .select()
      .from(buildings)
      .where(
        and(
          ne(buildings.status, "rejected"),
          sql`${buildings.centerLat} BETWEEN ${minLat} AND ${maxLat}`,
          sql`${buildings.centerLng} BETWEEN ${minLng} AND ${maxLng}`,
        ),
      )
      .limit(400);
    const versions = bs.length
      ? await db
          .select()
          .from(buildingVersions)
          .where(
            and(
              inArray(
                buildingVersions.buildingId,
                bs.map((b) => b.id),
              ),
            ),
          )
      : [];
    const latest = new Map<string, (typeof versions)[number]>();
    for (const v of versions) {
      const b = bs.find((x) => x.id === v.buildingId);
      if (b && b.currentVersion === v.version) latest.set(b.id, v);
    }
    out.buildings = {
      type: "FeatureCollection",
      features: bs.map((b) => {
        const v = latest.get(b.id);
        const foot = (v?.footprint ?? null) as
          | { type: "Polygon"; coordinates: number[][][] }
          | null;
        return {
          type: "Feature",
          geometry:
            foot ??
            {
              type: "Point",
              coordinates: [b.centerLng, b.centerLat],
            },
          properties: {
            id: b.id,
            name: b.name,
            status: b.status,
            verification: b.verification,
            version: v?.version ?? 0,
            type: v?.type ?? "none",
            confidence: v?.confidence ?? 0,
            heightM: v?.heightM ?? null,
            floors: v?.floors ?? null,
            buildingType: v?.buildingType ?? "unknown",
            center: [b.centerLng, b.centerLat],
          },
        };
      }),
    };
  }

  if (kinds.includes("captures")) {
    const cs = await db
      .select()
      .from(captures)
      .where(
        and(
          ne(captures.status, "rejected"),
          sql`${captures.gpsLat} BETWEEN ${minLat} AND ${maxLat}`,
          sql`${captures.gpsLng} BETWEEN ${minLng} AND ${maxLng}`,
        ),
      )
      .orderBy(desc(captures.createdAt))
      .limit(300);
    out.captures = {
      type: "FeatureCollection",
      features: cs.map((c) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [c.gpsLng ?? 0, c.gpsLat ?? 0],
        },
        properties: {
          id: c.id,
          kind: c.kind,
          status: c.status,
          accuracyM: c.gpsHAccuracy,
          heading: c.gpsHeading,
          buildingId: c.buildingId,
          createdAt: c.createdAt.toISOString(),
        },
      })),
    };
  }

  if (kinds.includes("coverage")) {
    const cs = await db
      .select({ lat: captures.gpsLat, lng: captures.gpsLng })
      .from(captures)
      .where(
        and(
          sql`${captures.gpsLat} BETWEEN ${minLat - 0.01} AND ${maxLat + 0.01}`,
          sql`${captures.gpsLng} BETWEEN ${minLng - 0.01} AND ${maxLng + 0.01}`,
        ),
      )
      .limit(5000);
    const grid = new Map<string, { lat: number; lng: number; count: number }>();
    for (const c of cs) {
      if (c.lat == null || c.lng == null) continue;
      const gx = Math.floor(c.lng / CELL);
      const gy = Math.floor(c.lat / CELL);
      const k = `${gx}:${gy}`;
      const cell = grid.get(k) ?? {
        lat: (gy + 0.5) * CELL,
        lng: (gx + 0.5) * CELL,
        count: 0,
      };
      cell.count++;
      grid.set(k, cell);
    }
    out.coverage = {
      type: "FeatureCollection",
      features: [...grid.values()].map((cell) => {
        // Tier: no/low(1-2)/partial(3-5)/good(6-10)/high(11+)
        const tier =
          cell.count >= 11 ? 4 : cell.count >= 6 ? 3 : cell.count >= 3 ? 2 : 1;
        return {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [cell.lng - CELL / 2, cell.lat - CELL / 2],
                [cell.lng + CELL / 2, cell.lat - CELL / 2],
                [cell.lng + CELL / 2, cell.lat + CELL / 2],
                [cell.lng - CELL / 2, cell.lat + CELL / 2],
                [cell.lng - CELL / 2, cell.lat - CELL / 2],
              ],
            ],
          },
          properties: { count: cell.count, tier },
        };
      }),
    };
  }

  return NextResponse.json(out);
}
