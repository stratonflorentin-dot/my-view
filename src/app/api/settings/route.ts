import { NextResponse } from "next/server";
import { clientIp, requireRole, getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import {
  DEFAULT_SETTINGS,
  getSettings,
  setSetting,
} from "@/lib/config";

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Access required" }, { status: 401 });
  }
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

/** Admin: platform name, visibility, thresholds. */
export async function PUT(req: Request) {
  const user = await requireRole(["admin"]);
  if (!user) return jsonError("Authentication required", 401);
  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return jsonError("Invalid JSON");

  if (
    body.platform_name != null &&
    typeof body.platform_name === "string" &&
    body.platform_name.trim()
  ) {
    await setSetting("platform_name", body.platform_name.trim().slice(0, 60));
  }
  if (
    body.map_visibility != null &&
    ["public", "invite_only", "private"].includes(body.map_visibility as string)
  ) {
    await setSetting("map_visibility", body.map_visibility);
    await audit(
      user,
      "settings.visibility",
      "setting",
      "map_visibility",
      { value: body.map_visibility },
      clientIp(req),
    );
  }
  if (typeof body.gps_max_accuracy_m === "number") {
    const v = Math.min(50, Math.max(3, body.gps_max_accuracy_m));
    await setSetting("gps_max_accuracy_m", v);
  }
  if (typeof body.multi_view_min_captures === "number") {
    const v = Math.min(16, Math.max(2, Math.floor(body.multi_view_min_captures)));
    await setSetting("multi_view_min_captures", v);
  }

  return NextResponse.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS });
}
