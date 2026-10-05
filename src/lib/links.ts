import { randomBytes } from "node:crypto";
import type { contributorLinks } from "@/db/schema";

/**
 * Public link tokens: 10 chars from an unambiguous alphabet (no 0/O/1/I).
 * ~46 bits of entropy — unguessable, and never an internal database id.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateToken(len = 10): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export type LinkRow = typeof contributorLinks.$inferSelect;

export type LinkCheck =
  | { ok: true; link: LinkRow }
  | {
      ok: false;
      reason:
        | "not_found"
        | "revoked"
        | "expired"
        | "submission_limit"
        | "already_used";
      message: string;
    };

export function checkLink(
  link: LinkRow | null,
  opts: { sessionId?: string; countingAsUse?: boolean } = {},
): LinkCheck {
  if (!link) {
    return {
      ok: false,
      reason: "not_found",
      message: "This mapping link does not exist.",
    };
  }
  if (link.revokedAt) {
    return {
      ok: false,
      reason: "revoked",
      message: "This mapping link has been revoked by the owner.",
    };
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: "This mapping link has expired.",
    };
  }
  if (link.oneTime && link.usedSessionId && !opts.countingAsUse) {
    return {
      ok: false,
      reason: "already_used",
      message: "This one-time mapping link has already been used.",
    };
  }
  if (
    !opts.countingAsUse &&
    link.maxSubmissions != null &&
    link.usedSubmissions >= link.maxSubmissions
  ) {
    return {
      ok: false,
      reason: "submission_limit",
      message: "This mapping link has reached its submission limit.",
    };
  }
  return { ok: true, link };
}
