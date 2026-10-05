import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clientIp, hashPassword, requireRole } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

/** Admin: list accounts. */
export async function GET() {
  if (!(await requireRole(["admin"]))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rows = await db.select().from(users);
  return NextResponse.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
    })),
  });
}

/** Admin: create an account with any role. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "auth");
  if (limited) return limited;
  const admin = await requireRole(["admin"]);
  if (!admin) return jsonError("Authentication required", 401);
  const body = await parseJson<{
    email?: string;
    password?: string;
    name?: string;
    role?: "admin" | "contributor" | "viewer";
  }>(req);
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return jsonError("A valid email is required");
  if (!body?.password || body.password.length < 8)
    return jsonError("Password must be at least 8 characters");
  const role = body?.role ?? "viewer";
  if (!["admin", "contributor", "viewer"].includes(role))
    return jsonError("Invalid role");
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]) return jsonError("Email already in use", 409);
  const rows = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(body.password),
      displayName: (body?.name?.trim() || email.split("@")[0]).slice(0, 120),
      role,
    })
    .returning();
  const u = rows[0];
  await audit(admin, "user.create", "user", u.id, { role }, clientIp(req));
  return NextResponse.json(
    {
      user: {
        id: u.id,
        email: u.email,
        name: u.displayName,
        role: u.role,
        createdAt: u.createdAt,
      },
    },
    { status: 201 },
  );
}
