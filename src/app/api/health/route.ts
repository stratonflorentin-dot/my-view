import { NextResponse } from "next/server";
import { ensureWorkerStarted } from "@/lib/pipeline/worker";

export async function GET() {
  ensureWorkerStarted();
  return NextResponse.json({ ok: true, service: "myworld3d" });
}
