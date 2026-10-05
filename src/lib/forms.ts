import type { FormField } from "@/db/schema";

/**
 * Flexible form system. Field definitions are JSON; answers are stored as
 * JSONB on submissions — custom fields never require schema changes.
 */

export type FormValidation =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

export function validateFormData(
  fields: FormField[],
  input: unknown,
): FormValidation {
  const values = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};

  for (const f of fields) {
    const v = values[f.key];
    const empty = v == null || v === "";
    if (f.required && empty) {
      errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (empty) continue;
    switch (f.type) {
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n)) errors[f.key] = `${f.label} must be a number`;
        else clean[f.key] = n;
        break;
      }
      case "select":
        if (f.options && !f.options.includes(String(v))) {
          errors[f.key] = `${f.label} must be one of: ${f.options.join(", ")}`;
        } else clean[f.key] = String(v);
        break;
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
          errors[f.key] = `${f.label} must be a valid email`;
        } else clean[f.key] = String(v);
        break;
      case "url":
        try {
          clean[f.key] = new URL(String(v)).toString();
        } catch {
          errors[f.key] = `${f.label} must be a valid URL`;
        }
        break;
      case "phone":
        if (!/^[+()\-\s\d]{5,20}$/.test(String(v))) {
          errors[f.key] = `${f.label} must be a valid phone number`;
        } else clean[f.key] = String(v);
        break;
      default: {
        const s = String(v).slice(0, 4000);
        clean[f.key] = s;
      }
    }
  }

  // Reject unknown keys to keep payloads bounded and clean.
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(values)) {
    if (!known.has(k)) delete values[k];
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: clean };
}

export const DEFAULT_LOCATION_FIELDS: FormField[] = [
  { key: "buildingType", label: "Building type", type: "text" },
  { key: "floors", label: "Number of floors", type: "number" },
  {
    key: "condition",
    label: "Condition",
    type: "select",
    options: ["new", "good", "fair", "poor", "under construction", "abandoned"],
  },
  { key: "phone", label: "Phone", type: "phone" },
  { key: "website", label: "Website", type: "url" },
  { key: "openingHours", label: "Opening hours", type: "text" },
  { key: "notes", label: "Additional information", type: "textarea" },
];
