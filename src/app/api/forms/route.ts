import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { forms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { jsonError, parseJson } from "@/lib/api";
import { canManage, projectAccess } from "@/lib/tenancy";
import { DEFAULT_LOCATION_FIELDS } from "@/lib/forms";

/** Custom forms per project — flexible JSON fields, no schema changes. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required");
  const user = await getSession();
  const { level } = await projectAccess(user, projectId);
  if (!level) return jsonError("forbidden", 403);
  const rows = await db.select().from(forms).where(eq(forms.projectId, projectId));
  return NextResponse.json({ forms: rows });
}

export async function POST(req: Request) {
  const user = await getSession();
  const body = await parseJson<{
    projectId?: string;
    name?: string;
    fields?: unknown;
    template?: "real_estate" | "logistics" | "agriculture";
  }>(req);
  if (!body?.projectId || !body.name) return jsonError("projectId and name required");
  const { level } = await projectAccess(user, body.projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);

  let fields = body.fields as never;
  if (body.template && !body.fields) {
    fields = templateFields(body.template) as never;
  }
  if (!Array.isArray(fields)) {
    return jsonError("fields must be an array of field definitions (or use a template)");
  }

  const rows = await db
    .insert(forms)
    .values({
      projectId: body.projectId,
      name: body.name.slice(0, 160),
      fields,
    })
    .returning();
  return NextResponse.json({ form: rows[0] }, { status: 201 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");
  const user = await getSession();
  const rows = await db.select().from(forms).where(eq(forms.id, id)).limit(1);
  if (!rows[0]) return jsonError("Not found", 404);
  const { level } = await projectAccess(user, rows[0].projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);
  await db.delete(forms).where(eq(forms.id, id));
  return NextResponse.json({ ok: true });
}

function templateFields(template: string) {
  switch (template) {
    case "real_estate":
      return [
        { key: "propertyName", label: "Property name", type: "text", required: true },
        { key: "bedrooms", label: "Bedrooms", type: "number" },
        { key: "bathrooms", label: "Bathrooms", type: "number" },
        { key: "price", label: "Price", type: "number" },
        { key: "landSize", label: "Land size (m²)", type: "number" },
        { key: "buildingSize", label: "Building size (m²)", type: "number" },
        { key: "owner", label: "Owner", type: "text" },
        { key: "contact", label: "Contact", type: "phone" },
      ];
    case "logistics":
      return [
        { key: "warehouse", label: "Warehouse name", type: "text", required: true },
        { key: "truckAccess", label: "Truck access", type: "select", options: ["yes", "no", "limited"] },
        { key: "loadingArea", label: "Loading area", type: "select", options: ["dock", "ground level", "none"] },
        { key: "operatingHours", label: "Operating hours", type: "text" },
        { key: "contact", label: "Contact", type: "phone" },
      ];
    case "agriculture":
      return [
        { key: "farmName", label: "Farm name", type: "text", required: true },
        { key: "crop", label: "Crop", type: "text" },
        { key: "area", label: "Area (ha)", type: "number" },
        { key: "irrigation", label: "Irrigation", type: "select", options: ["rain-fed", "sprinkler", "drip", "flood", "none"] },
        { key: "waterSource", label: "Water source", type: "text" },
        { key: "owner", label: "Owner", type: "text" },
      ];
    default:
      return DEFAULT_LOCATION_FIELDS;
  }
}
