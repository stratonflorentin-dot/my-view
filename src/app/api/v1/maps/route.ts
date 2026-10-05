import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions, mapObjects, projects } from "@/db/schema";
import { requireKey, isResponse, v1Error, loadScopedProject } from "@/lib/v1";

/**
 * GET /api/v1/maps — the map this key is scoped to.
 * GET /api/v1/maps/{mapId} — single map detail (maps:read).
 */
export async function GET(req: Request) {
  const ctx = await requireKey(req, "maps:read");
  if (isResponse(ctx)) return ctx;
  const project = await loadScopedProject(ctx.projectId);
  if (!project) return v1Error("Map not found", 404);

  const url = new URL(req.url);
  const counts = url.searchParams.get("include") === "counts";
  if (!counts) {
    return NextResponse.json({ data: [serialize(project)] });
  }
  const [b, o] = await Promise.all([
    db.select({ id: buildings.id }).from(buildings).where(and(eq(buildings.projectId, project.id), ne(buildings.status, "rejected"))),
    db.select({ id: mapObjects.id }).from(mapObjects).where(eq(mapObjects.projectId, project.id)),
  ]);
  return NextResponse.json({
    data: [
      {
        ...serialize(project),
        counts: { buildings: b.length, objects: o.length },
      },
    ],
  });
}

function serialize(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    visibility: p.visibility,
    center: p.centerLat != null && p.centerLng != null ? { lat: p.centerLat, lng: p.centerLng } : null,
    defaultZoom: p.defaultZoom,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
