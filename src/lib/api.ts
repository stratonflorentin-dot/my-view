import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { SessionUser } from "./auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function audit(
  actor: SessionUser | { sub: string; role: string },
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Record<string, unknown>,
  ip?: string,
) {
  await db
    .insert(auditLogs)
    .values({
      actorType: "user",
      actorId: actor.sub,
      action,
      entity: entity ?? null,
      entityId: entityId ?? null,
      detail: (detail ?? null) as never,
      ip: ip ?? null,
    })
    .catch(() => {});
}
