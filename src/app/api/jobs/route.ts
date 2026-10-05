import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import { requireRole } from "@/lib/auth";

/** Admin: processing queue overview. */
export async function GET(req: Request) {
  if (!(await requireRole(["admin"]))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const jobs = await db
    .select()
    .from(processingJobs)
    .where(status ? eq(processingJobs.status, status as never) : undefined)
    .orderBy(desc(processingJobs.createdAt))
    .limit(200);
  return NextResponse.json({ jobs });
}
