import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { requireRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/** Admin: read the processing log of a job. */
export async function GET(_req: Request, { params }: Params) {
  await requireRole(["admin"]);
  const { id } = await params;
  const buf = await storage.get(`jobs/${id}.log`);
  return NextResponse.json({ log: buf ? buf.toString() : "" });
}
