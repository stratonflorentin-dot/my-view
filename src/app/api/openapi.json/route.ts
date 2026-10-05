import { NextResponse } from "next/server";

/** Hand-maintained OpenAPI 3.1 document for the public API. */
export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "MyWorld 3D Map API",
      version: "1.0.0",
      description:
        "Private, contributor-driven 3D mapping platform. All endpoints are JSON unless noted. Authentication is via the httpOnly session cookie; contributor flows are token-based and require no account.",
    },
    servers: [{ url: "/" }],
    paths: {
      "/api/auth/login": {
        post: {
          summary: "Sign in",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Session cookie set" } },
        },
      },
      "/api/auth/register": {
        post: {
          summary: "Register a viewer account",
          responses: { "201": { description: "Account created" } },
        },
      },
      "/api/auth/logout": { post: { summary: "Sign out" } },
      "/api/auth/me": { get: { summary: "Current session" } },
      "/api/links": {
        get: { summary: "List contributor links", security: [{ admin: [] }] },
        post: {
          summary: "Create a contributor link",
          description:
            "Token is a 10-char unambiguous random string; internal UUIDs are never exposed. Supports one-time, expiry, submission caps, area/location scoping, video permission.",
          security: [{ admin: [] }],
        },
      },
      "/api/links/{id}": {
        post: { summary: "revoke | restore | delete a link", security: [{ admin: [] }] },
      },
      "/api/contribute/validate": {
        get: {
          summary: "Validate a mapping link (public, token query param)",
          responses: { "200": { description: "Link state + resume session" } },
        },
      },
      "/api/sessions": {
        post: {
          summary: "Start/resume a capture session",
          description:
            "Server re-validates every permission. Location-scoped links attach outstanding imagery requests.",
        },
      },
      "/api/captures": {
        post: {
          summary: "Upload a capture (photo/video + GPS)",
          description:
            "Body: sessionId, kind, mime, base64, gps(lat, lng, altitude, hAccuracy, vAccuracy, heading, source, deviceTs). GPS accuracy is graded; more than 2x threshold is rejected. Geographic scope is enforced server-side. A processing job is enqueued.",
        },
      },
      "/api/captures/{id}": {
        get: { summary: "Capture processing status" },
      },
      "/api/files/{key}": {
        get: { summary: "Signed object storage download (HMAC + expiry)" },
      },
      "/api/map/features": {
        get: {
          summary: "Viewport GeoJSON (buildings, captures, coverage grid)",
          description:
            "Only objects inside the requested bbox are returned; the browser never loads the full table.",
        },
      },
      "/api/buildings": { get: { summary: "List/search buildings" } },
      "/api/buildings/{id}": {
        get: { summary: "Building dossier: versions, captures, sessions, GPS" },
      },
      "/api/buildings/{id}/actions": {
        post: {
          summary: "approve | reject | reprocess | request_imagery | rename | delete",
          security: [{ admin: [] }],
        },
      },
      "/api/jobs": {
        get: { summary: "Processing queue", security: [{ admin: [] }] },
      },
      "/api/jobs/{id}/retry": {
        post: { summary: "Retry failed job", security: [{ admin: [] }] },
      },
      "/api/jobs/{id}/logs": {
        get: { summary: "Job processing log", security: [{ admin: [] }] },
      },
      "/api/stats": {
        get: { summary: "Dashboard statistics", security: [{ admin: [] }] },
      },
      "/api/users": {
        get: { summary: "List accounts", security: [{ admin: [] }] },
        post: { summary: "Create account", security: [{ admin: [] }] },
      },
      "/api/settings": {
        get: { summary: "Platform settings" },
        put: { summary: "Update settings", security: [{ admin: [] }] },
      },
      "/api/audit": {
        get: { summary: "Audit trail", security: [{ admin: [] }] },
      },
      "/api/search": { get: { summary: "In-platform geographic search" } },
    },
    components: {
      securitySchemes: {
        admin: { type: "apiKey", in: "cookie", name: "mwm_session" },
      },
    },
  };
  return NextResponse.json(spec, {
    headers: { "Content-Type": "application/json" },
  });
}
