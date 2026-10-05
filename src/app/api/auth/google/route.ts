import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";

export const GOOGLE_STATE_COOKIE = "mwm_oauth_state";
const STATE_TTL_SEC = 600; // 10 minutes

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

/** Public origin of this deployment (APP_URL override, else request origin). */
export function appOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const url = new URL(req.url);
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export function googleRedirectUri(req: Request): string {
  return `${appOrigin(req)}/api/auth/google/callback`;
}

/**
 * Starts the Google OAuth 2.0 authorization-code flow.
 * Redirects the browser to Google's consent screen.
 */
export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next") || "/map";
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("Google sign-in is not configured")}`, appOrigin(req)),
    );
  }

  const state = randomUUID();
  const store = await cookies();
  store.set(GOOGLE_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SEC,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
