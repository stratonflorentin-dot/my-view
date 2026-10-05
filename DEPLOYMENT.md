# Deployment

## Build & run

```bash
npm ci
npx drizzle-kit push        # or apply scripts/migrations/ in order
npm run build
npm start
```

Node ≥ 20. The processing worker starts automatically with the server
process (`src/instrumentation.ts`).

## Production checklist

> **MapLibre worker note:** `public/maplibre-gl-worker.mjs` +
> `public/maplibre-gl-shared.mjs` are copies of the installed `maplibre-gl`
> dist worker (the bundler-generated worker URL breaks under Turbopack).
> If you upgrade `maplibre-gl`, re-copy these two files from
> `node_modules/maplibre-gl/dist/`.

1. **Secrets** — set real `AUTH_SECRET`, `FILE_SIGNING_KEY`, `DATABASE_URL`.
2. **PostGIS** — if available, apply `scripts/migrations/0001_postgis.sql`
   and switch the coordinate columns (see DATABASE.md); the application
   logic is unchanged.
3. **Storage** — point `STORAGE_DRIVER` at an S3-compatible implementation of
   `src/lib/storage` (interface: `put/get/delete/exists/size`), or keep the
   local store on a persistent volume.
4. **Multi-node** — replace the single-lane worker with a
   `UPDATE … FOR UPDATE SKIP LOCKED` claim loop (schema already supports it)
   and move the rate limiter to Redis.
5. **Engines** — set `RECON_API_URL` / `DETECTION_API_URL` to activate
   photogrammetry / vision (contract in 3D_RECONSTRUCTION.md).
6. **HTTPS + TLS** at the proxy; cookies auto-upgrade to `Secure` in prod.
7. **Backups** — Postgres + the storage directory.

## Observability

- `/api/health` — liveness (also boots the worker).
- Admin → **Processing** — job queue with per-job logs and retry.
- Admin → **Audit** — full admin action trail.
