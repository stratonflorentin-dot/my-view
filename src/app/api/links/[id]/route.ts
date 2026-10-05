import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contributorLinks } from "@/db/schema";
import { clientIp, requireRole } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

/** Admin: revoke / restore / delete a contributor link. */
export async function POST(req: Request, { params }: Params) {
  const user = await requireRole(["admin"]);
  const { id } = await params;
  const body = await parseJson<{ action?: "revoke" | "restore" | "delete" }>(
    req,
  );
  const action = body?.action;
  const rows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.id, id))
    .limit(1);
  const link = rows[0];
  if (!link) return jsonError("Link not found", 404);

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
