# DEVELOPER_GUIDE.md

## Two kinds of users

1. **Map owners** — sign in, create projects, generate scan links, review
   submissions, manage API keys. UI: `/dashboard`.
2. **Developers** — consume the Map API from external applications with
   API keys. Reference: `API.md`, SDK: `sdk/README.md`.

## Quick start (map owner)

1. Sign up at `/register` → land on `/dashboard`.
2. **Create project** (name, visibility, optional center).
3. **Scan Links → Create scan link** → configure fence/permissions →
   **Generate link** → Copy → send `/scan/ABC123` to contributors.
4. **Submissions** tab → review → Approve (object appears on `/map`).
5. **Developers** tab → create API key → call `/api/v1/…` from your app.
6. **Embed & Share** tab → copy the `<iframe>` snippet.

## Architecture (modular boundaries)

```
Next.js app (frontend + API routes)
  ├─ src/lib/tenancy.ts      project/membership authorization
  ├─ src/lib/fence.ts        circle/rect/polygon geo-fences
  ├─ src/lib/apiKeys.ts      key auth, scopes, rate limits, usage
  ├─ src/lib/forms.ts        flexible custom forms (JSON, no migrations)
  ├─ src/lib/webhooks.ts     event fan-out, HMAC signing, retries
  ├─ src/lib/storage/        ObjectStorage interface (local | S3 driver)
  └─ src/lib/pipeline/       background jobs + engines
       ├─ engines.ts         ReconstructionEngine / BuildingDetectionEngine registries
       ├─ pipeline.ts        capture processing, grouping, versioning
       └─ worker.ts          Postgres-backed queue worker + webhook delivery

Python AI service (python-service/, FastAPI) — optional
  └─ CV endpoints wired through DETECTION_API_URL / RECON_API_URL
```

## Replacing platform pieces

| Piece | Where | How |
|---|---|---|
| Map tiles | `src/components/map/MapView.tsx` | MapLibre style config; keyless Esri/CARTO fallback + optional MapTiler |
| Storage | `src/lib/storage/index.ts` | Implement `ObjectStorage` (S3/R2/…), set `STORAGE_DRIVER` |
| Reconstruction | `src/lib/pipeline/engines.ts` | Register a new engine; keep the response contract |
| Detection | `src/lib/pipeline/engines.ts` or `python-service` | Swap YOLO for any detector |
| Auth | `src/lib/auth.ts` | JWT/bcrypt today; adapter point for OAuth later |

## Background jobs

Queue lives in Postgres (`processing_jobs`) with priorities, retries,
error text and per-job logs. Worker starts in-process
(`ensureWorkerStarted()`). Job types: `capture.process`,
`building.reconstruct`, `building.publish`, `video.process`,
`model.optimize`, `webhook.deliver`.

## Tests & verification

```bash
npm run test     # vitest unit suite (geo, GPS, fences, forms, keys, webhooks)
npm run build    # Next.js production build
npx tsc --noEmit # types
```

## Security checklist for deployments

- `JWT_SECRET` set (32+ random bytes) — sessions and signed URLs depend on it.
- Postgres + PostGIS enabled (`scripts/migrations/0001_postgis.sql`).
- HTTPS only; scan links are public URLs — treat tokens as capabilities.
- API secret keys never leave the server; public keys are read-scoped and
  origin-restricted.
