import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  buildings,
  buildingVersions,
  captures,
  contributorLinks,
} from "@/db/schema";
import { clientIp, requireRole } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { generateToken } from "@/lib/links";
import { enqueueJob } from "@/lib/pipeline/pipeline";
import { ensureWorkerStarted } from "@/lib/pipeline/worker";

type Params = { params: Promise<{ id: string }> };

/**
 * Admin review actions: approve / reject / reprocess /
 * request_imagery / rename / delete.
 */
export async function POST(req: Request, { params }: Params) {
  const user = await requireRole(["admin"]);
  if (!user) return jsonError("Authentication required", 401);
  ensureWorkerStarted();
  const { id } = await params;
  const body = await parseJson<{
    action?:
      | "approve"
      | "reject"
      | "reprocess"
      | "request_imagery"
      | "rename"
      | "delete";
    note?: string;
    name?: string;
  }>(req);
  const action = body?.action;
  if (!action) return jsonError("action is required");

  const rows = await db
    .select()
    .from(buildings)
    .where(eq(buildings.id, id))
    .limit(1);
  const b = rows[0];
  if (!b) return jsonError("Building not found", 404);

  switch (action) {
    case "approve":
      await db
        .update(buildings)
        .set({
          status: "approved",
          verification: "verified",
          requestedImagery: null,
          updatedAt: new Date(),
        })
        .where(eq(buildings.id, id));
      break;
    case "reject":
      await db
        .update(buildings)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(buildings.id, id));
      break;
    case "reprocess": {
      await enqueueJob("building.reconstruct", { buildingId: id }, 7);
      break;
    }
    case "request_imagery": {
      const note =
        (body.note ??
          "Additional photographs required. Please capture the missing sides of the building.")
          .slice(0, 1000);
      await db
        .update(buildings)
        .set({ requestedImagery: note, updatedAt: new Date() })
        .where(eq(buildings.id, id));
      const link = await db
        .insert(contributorLinks)
        .values({
          token: generateToken(),
          label: `Imagery request: ${b.name ?? id.slice(0, 8)}`,
          scope: "location",
          centerLat: b.centerLat,
          centerLng: b.centerLng,
          radiusM: 150,
          maxSubmissions: 20,
          expiresAt: new Date(Date.now() + 14 * 86400_000),
          createdBy: user.sub,
        })
        .returning();
      await audit(user, "building.request_imagery", "building", id, {
        note,
        link: link[0].token,
      }, clientIp(req));
      return NextResponse.json({
        ok: true,
        contributePath: `/contribute/${link[0].token}`,
      });
    }
    case "rename":
      if (!body.name?.trim()) return jsonError("name is required");
      await db
        .update(buildings)
        .set({ name: body.name.trim().slice(0, 160), updatedAt: new Date() })
        .where(eq(buildings.id, id));
      break;
    case "delete":
      await db
        .update(captures)
        .set({ buildingId: null })
        .where(eq(captures.buildingId, id));
      await db
        .delete(buildingVersions)
        .where(eq(buildingVersions.buildingId, id));
      await db.delete(buildings).where(eq(buildings.id, id));
      break;
    default:
      return jsonError("Unknown action");
  }

  await audit(user, `building.${action}`, "building", id, {
    note: body.note,
  }, clientIp(req));
  return NextResponse.json({ ok: true });
}
