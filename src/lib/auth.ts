import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { authSecret } from "./config";

export const SESSION_COOKIE = "mwm_session";
export const SESSION_TTL_SEC = 60 * 60 * 12; // 12h

export type SessionUser = {
  sub: string;
  email: string;
  name: string;
  role: "admin" | "contributor" | "viewer";
};

const secret = () => new TextEncoder().encode(authSecret());

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: (payload.role as SessionUser["role"]) ?? "viewer",
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new AuthError("unauthenticated");
  return u;
}

/**
 * Role gate that returns the user or null (never throws). A null return
 * means either no session (401) or insufficient role (403); routes respond
 * accordingly.
 */
export async function requireRole(
  roles: SessionUser["role"][],
): Promise<SessionUser | null> {
  const u = await getSession();
  if (!u) return null;
  if (!roles.includes(u.role)) return null;
  return u;
}

export class AuthError extends Error {
  status: number;
  constructor(msg: "unauthenticated" | "forbidden") {
    super(msg);
    this.status = msg === "forbidden" ? 403 : 401;
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() as string) || req.headers.get("x-real-ip") || "unknown";
}
