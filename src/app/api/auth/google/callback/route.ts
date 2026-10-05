import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clientIp, isAdminEmail, SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/auth";
import { audit } from "@/lib/api";
import { GOOGLE_STATE_COOKIE, googleOAuthConfigured, googleRedirectUri, appOrigin } from "../route";

function fail(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, origin),
  );
}

/** Relative-path guard against open redirects. */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/map";
}

type GoogleProfile = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

/**
 * OAuth 2.0 callback: validates state, exchanges the code, upserts the user
 * (linking an existing email account when one exists), then issues the
 * regular session cookie.
 */
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(origin, "Google sign-in was cancelled");

  const store = await cookies();
  const cookieState = store.get(GOOGLE_STATE_COOKIE)?.value ?? "";
  store.delete(GOOGLE_STATE_COOKIE);
  const [expectedState, nextRaw] = cookieState.split("|");
  const next = safeNext(nextRaw || "/map");
  if (!state || state !== expectedState)
    return fail(origin, "Invalid sign-in state — please try again");

  if (!googleOAuthConfigured())
    return fail(origin, "Google sign-in is not configured");

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(origin, "Google token exchange failed");
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return fail(origin, "Google token exchange failed");

  const profRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profRes.ok) return fail(origin, "Could not read your Google profile");
  const profile = (await profRes.json()) as GoogleProfile;
  const email = profile.email?.toLowerCase();
  if (!email || !profile.email_verified)
    return fail(origin, "Your Google account has no verified email");

  // Find by Google id, else by email (link), else create a viewer account.
  // ADMIN_EMAIL addresses are promoted to admin on every Google sign-in.
  let created = false;
  const role = isAdminEmail(email) ? "admin" : "viewer";
  let row = (
    await db.select().from(users).where(eq(users.googleId, profile.sub)).limit(1)
  )[0];
  if (!row) {
    const byEmail = (
      await db.select().from(users).where(eq(users.email, email)).limit(1)
    )[0];
    if (byEmail) {
      row = (
        await db
          .update(users)
          .set({ googleId: profile.sub, ...(role !== byEmail.role ? { role } : {}) })
          .where(eq(users.id, byEmail.id))
          .returning()
      )[0];
    } else {
      created = true;
      row = (
        await db
          .insert(users)
          .values({
            email,
            passwordHash: null,
            googleId: profile.sub,
            displayName: (profile.name || email.split("@")[0]).slice(0, 120),
            role,
          })
          .returning()
      )[0];
    }
  }

  const token = await signSession({
    sub: row.id,
    email: row.email,
    name: row.displayName,
    role: row.role,
  });
  const res = NextResponse.redirect(new URL(next, origin));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  await audit(
    { sub: row.id, role: row.role },
    "auth.google_signin",
    "user",
    row.id,
    { email: row.email, created },
    clientIp(req),
  ).catch(() => {});
  return res;
}
