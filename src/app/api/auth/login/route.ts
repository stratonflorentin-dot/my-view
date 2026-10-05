import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  clientIp,
  hashPassword,
  requireRole,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  signSession,
  verifyPassword,
} from "@/lib/auth";
import { jsonError, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limited = rateLimit(req, "auth");
  if (limited) return limited;
  const body = await parseJson<{
    email?: string;
    password?: string;
  }>(req);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  if (!email || !password) return jsonError("Email and password required");

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return jsonError("Invalid credentials", 401);
  }
  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.displayName,
    role: user.role,
  });
  const res = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.displayName,
      role: user.role,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}

export { clientIp };
