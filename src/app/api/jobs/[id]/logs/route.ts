import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { requireRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/** Admin: read the processing log of a job. */
export async function GET(_req: Request, { params }: Params) {
  if (!(await requireRole(["admin"]))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const { id } = await params;
  const buf = await storage.get(`jobs/${id}.log`);
  return NextResponse.json({ log: buf ? buf.toString() : "" });
}
