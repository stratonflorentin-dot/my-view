import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The drizzle client requires the var at import time; the pool is lazy,
    // so no connection is made for unit tests.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    },
  },
});
