# Environment variables

Copy `.env.example` to `.env.local`. **Never commit real secrets.**

| Variable | Default (dev) | Description |
|---|---|---|
| `DATABASE_URL` | sandbox | PostgreSQL connection string |
| `AUTH_SECRET` | dev-only | HMAC secret for session JWTs — **must** be a long random string in prod |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@myworld.local` / `admin1234` | Seeded admin (used by `scripts/seed-demo.sh`) |
| `FILE_SIGNING_KEY` | dev-only | HMAC key for signed object URLs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Enables "Sign in with Google". Create OAuth credentials at console.cloud.google.com and add `<origin>/api/auth/google/callback` as an authorized redirect URI (e.g. `http://localhost:3111/api/auth/google/callback`). Unset = the Google button explains it is not configured. |
| `APP_URL` | — | Public origin used to build the Google redirect URI behind proxies; auto-derived from request headers when unset |
| `STORAGE_DRIVER` | `local` | `local` filesystem store (S3 driver: implement `src/lib/storage` interface) |
| `STORAGE_DIR` | `./storage` | Object-storage root |
| `PLATFORM_NAME` | `MyWorld 3D Map` | Branding (runtime-overridable in admin settings) |
| `MAP_VISIBILITY` | `invite_only` | `public` \| `invite_only` \| `private` |
| `NEXT_PUBLIC_MAPTILER_API_KEY` | — | Optional: upgrades satellite/streets basemaps |
| `RECON_ENGINE` | `estimated` | `estimated` \| `photogrammetry` \| `neural` |
| `RECON_API_URL` / `RECON_API_KEY` | — | External reconstruction service (contract in `3D_RECONSTRUCTION.md`). Unset = built-in estimation engines only. |
| `DETECTION_API_URL` / `DETECTION_API_KEY` | — | External building-detection service (height, floors, type). Unset = anchor detection (no invented attributes). |
