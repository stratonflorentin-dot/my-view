import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contributorLinks } from "@/db/schema";
import { clientIp, requireUser } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { canManage, projectAccess } from "@/lib/tenancy";

type Params = { params: Promise<{ id: string }> };

/**
 * Revoke / restore / delete a scan link.
 * Permission: platform admin, or owner/editor of the link's project.
 */
export async function POST(req: Request, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const body = await parseJson<{ action?: "revoke" | "restore" | "delete" }>(req);
  const action = body?.action;
  const rows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.id, id))
    .limit(1);
  const link = rows[0];
  if (!link) return jsonError("Link not found", 404);

  if (link.projectId) {
    const { level } = await projectAccess(user, link.projectId);
    if (!level || !canManage(level)) return jsonError("forbidden", 403);
  } else if (user.role !== "admin") {
    return jsonError("forbidden", 403);
  }

  if (action === "revoke") {
    await db
      .update(contributorLinks)
      .set({ revokedAt: new Date() })
      .where(eq(contributorLinks.id, id));
  } else if (action === "restore") {
    await db
      .update(contributorLinks)
      .set({ revokedAt: null })
      .where(eq(contributorLinks.id, id));
  } else if (action === "delete") {
    await db.delete(contributorLinks).where(eq(contributorLinks.id, id));
  } else {
    return jsonError("Unknown action");
  }
  await audit(user, `link.${action}`, "contributor_link", id, undefined, clientIp(req));
  return NextResponse.json({ ok: true });
}
