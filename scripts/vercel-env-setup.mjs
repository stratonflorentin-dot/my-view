import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const { randomBytes } = await import("node:crypto");
const sets = {
  DATABASE_URL: env.DATABASE_URL,
  AUTH_SECRET: env.AUTH_SECRET || randomBytes(32).toString("hex"),
  FILE_SIGNING_KEY: env.FILE_SIGNING_KEY || randomBytes(32).toString("hex"),
  PLATFORM_NAME: "MyView Maps",
  MAP_VISIBILITY: "invite_only",
  RECON_ENGINE: "estimated",
  STORAGE_DRIVER: "vercel-blob",
};

for (const [key, value] of Object.entries(sets)) {
  if (!value) {
    console.log(`SKIP ${key} (empty)`);
    continue;
  }
  const tmp = `.env_tmp_${key}`;
  writeFileSync(tmp, value);
  for (const environment of ["production", "preview"]) {
    try {
      execSync(`npx vercel env add ${key} ${environment} --force < ${tmp}`, {
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      console.log(`OK ${key} -> ${environment}`);
    } catch (e) {
      console.log(`FAIL ${key} -> ${environment}: ${String(e.stderr || e.message).slice(0, 200)}`);
    }
  }
  unlinkSync(tmp);
}
