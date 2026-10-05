# Contributing

## Development

```bash
npm install
npx drizzle-kit push
npm run dev          # app + API + worker
npm run typecheck    # tsc --noEmit
npm run lint
npx vitest run       # unit tests (geo, gps, confidence, links, ahash)
```

## Layout rules

- **API** lives in `src/app/api/**` — thin route handlers over `src/lib`.
- **Engines** are only ever added via the registries in
  `src/lib/pipeline/engines.ts`; never hard-code a provider.
- **Geospatial math** goes in `src/lib/geo.ts` (shared by pipeline, API,
  client guidance).
- **UI primitives** (`mwm-panel`, `mwm-btn`, `mwm-input`, badges) are in
  `globals.css` — keep components thin.
- Every new admin mutation must call `audit()` and go through `requireRole`.

## Testing priorities

Auth, link policy, GPS validation, upload validation, permissions, spatial
queries, job retries, versioning, signed URLs, map viewport loading, and an
end-to-end contributor flow (see `tests/` for the seeded unit core).

## Definition of done

A change is done when it typechecks, the build passes, new behavior has a
test where testable, docs are updated, and no fake state is introduced —
if a capability isn't implemented, the UI says so.
