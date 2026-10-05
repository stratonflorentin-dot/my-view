import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  signSession,
} from "@/lib/auth";
import { jsonError, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

/** Public registration — always creates a viewer account. Admins promote
 *  accounts in the dashboard. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "auth");
  if (limited) return limited;
  const body = await parseJson<{
    email?: string;
    password?: string;
    name?: string;
  }>(req);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  const name = body?.name?.trim() ?? email?.split("@")[0] ?? "Viewer";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return jsonError("A valid email is required");
  if (password.length < 8)
    return jsonError("Password must be at least 8 characters");

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]) return jsonError("An account with this email exists", 409);

  const rows = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(password),
      displayName: name.slice(0, 120),
      role: "viewer",
    })
    .returning();
  const user = rows[0];
  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.displayName,
    role: "viewer",
  });
  const res = NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.displayName,
        role: user.role,
      },
    },
    { status: 201 },
  );
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
