import { NextResponse } from "next/server";
import { inArray, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/config";

/**
 * In-platform geographic search: buildings by name, id, or coordinate
 * prefix. Place-name geocoding is done client-side via OSM Nominatim.
 */
export async function GET(req: Request) {
  const settings = await getSettings();
  if (settings.map_visibility !== "public") {
    if (!(await getSession())) {
      return NextResponse.json({ error: "Access required" }, { status: 401 });
    }
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const like = `%${q}%`;
  const isCoord = /^\s*-?[\d.]+/.test(q);
  const rows = await db
    .select()
    .from(buildings)
    .where(
      or(
        ilike(buildings.name, like),
        ilike(buildings.id, like),
        isCoord ? ilike(buildings.centerLat, like) : undefined,
        isCoord ? ilike(buildings.centerLng, like) : undefined,
      ),
    )
    .limit(20);

  const latest = rows.length
    ? await db
        .select()
        .from(buildingVersions)
        .where(inArray(buildingVersions.buildingId, rows.map((r) => r.id)))
    : [];
  const verBy = new Map(latest.map((v) => [v.buildingId, v]));

  const results = rows
    .map((b) => {
      const v = verBy.get(b.id);
      return {
        id: b.id,
        name: b.name,
        centerLat: b.centerLat,
        centerLng: b.centerLng,
        status: b.status,
        version: b.currentVersion,
        type: v && v.version === b.currentVersion ? v.type : null,
        confidence: v && v.version === b.currentVersion ? v.confidence : null,
      };
    })
    .filter(
      (r) =>
        (r.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        r.id.toLowerCase().includes(q.toLowerCase()) ||
        isCoord,
    );
  return NextResponse.json({ results });
}
