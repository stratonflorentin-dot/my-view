import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireRole } from "@/lib/auth";

/** Admin: audit trail. */
export async function GET(req: Request) {
  await requireRole(["admin"]);
  const url = new URL(req.url);
  const limit = Math.min(300, Number(url.searchParams.get("limit") ?? 100));
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return NextResponse.json({ logs: rows });
}
