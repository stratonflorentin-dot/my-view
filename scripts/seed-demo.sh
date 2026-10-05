#!/usr/bin/env bash
# Seeds a demo dataset and admin account, then enqueues real processing
# jobs — the pipeline (metadata, quality, grouping, estimation, publish)
# runs for real against these captures.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/app_db}"
DAY="$(date +%F)"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@myworld.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"

U_ADMIN='a1000000-0000-0000-0000-0000000000a1'
U_LINK='b1000000-0000-0000-0000-0000000000b1'
U_SESS1='c1000000-0000-0000-0000-0000000000c1'
U_SESS2='c1000000-0000-0000-0000-0000000000c2'
C1='11111111-aaaa-1111-1111-111111111111'
C2='22222222-aaaa-2222-2222-222222222222'
C3='44444444-aaaa-4444-4444-444444444444'
C4='33333333-aaaa-3333-3333-333333333333'
C5='55555555-aaaa-5555-5555-555555555555'

ADMIN_HASH="$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$ADMIN_PASSWORD")"

# ---- storage objects (real files, served via signed URLs) ----
S1="storage/captures/$DAY/demo0001"
S2="storage/captures/$DAY/demo0002"
mkdir -p "$S1" "$S2"
cp scripts/demo-assets/front.jpg "$S1/$C1.jpg"
cp scripts/demo-assets/left.jpg  "$S1/$C2.jpg"
cp scripts/demo-assets/back.jpg  "$S1/$C3.jpg"
cp scripts/demo-assets/right.jpg "$S1/$C4.jpg"
cp scripts/demo-assets/left.jpg  "$S2/$C5.jpg"

# ---- database ----
psql -v ON_ERROR_STOP=1 "$DB" <<SQL
DELETE FROM gps_fixes WHERE id::text LIKE 'e1000000%';
DELETE FROM captures WHERE id IN ('$C1','$C2','$C3','$C4','$C5');
DELETE FROM capture_sessions WHERE id::text LIKE 'c1000000%';
DELETE FROM processing_jobs;
DELETE FROM contributor_links WHERE id = '$U_LINK';
DELETE FROM users WHERE id = '$U_ADMIN';
DELETE FROM building_versions WHERE building_id IN
  (SELECT id FROM buildings WHERE name IN ('Building 11111111','Building 55555555'));
DELETE FROM buildings WHERE name IN ('Building 11111111','Building 55555555');

INSERT INTO users (id, email, password_hash, display_name, role)
VALUES ('$U_ADMIN', '$ADMIN_EMAIL', '$ADMIN_HASH', 'Map Owner', 'admin');

INSERT INTO contributor_links (id, token, label, scope, center_lat, center_lng, radius_m, allow_video, max_submissions, one_time)
VALUES ('$U_LINK', 'KX7M2Q4V9R', 'Demo block — Old Town', 'area', -6.7935, 39.2120, 2500, true, 40, false);

INSERT INTO capture_sessions (id, link_token, contributor_name, device_info)
VALUES
  ('$U_SESS1', 'KX7M2Q4V9R', 'Amina (demo)', '{"ua":"demo"}'),
  ('$U_SESS2', 'KX7M2Q4V9R', 'Kwame (demo)', '{"ua":"demo"}');

-- Four angles around building A (center ~ -6.7935, 39.2120); one photo for building B.
INSERT INTO captures (id, session_id, kind, storage_key, mime, size_bytes, gps_lat, gps_lng, gps_altitude, gps_h_accuracy, gps_heading, gps_source, device_timestamp, status, created_at) VALUES
  ('$C1', '$U_SESS1', 'photo', 'captures/$DAY/demo0001/$C1.jpg', 'image/jpeg', 200000, -6.79341, 39.21200, 52.0, 4.2, 180, 'device', now(), 'received', now()),
  ('$C2', '$U_SESS1', 'photo', 'captures/$DAY/demo0001/$C2.jpg', 'image/jpeg', 200000, -6.79350, 39.21209, 51.5, 5.1, 270, 'device', now(), 'received', now()),
  ('$C3', '$U_SESS1', 'photo', 'captures/$DAY/demo0001/$C3.jpg', 'image/jpeg', 200000, -6.79359, 39.21200, 51.0, 4.8, 0,   'device', now(), 'received', now()),
  ('$C4', '$U_SESS1', 'photo', 'captures/$DAY/demo0001/$C4.jpg', 'image/jpeg', 200000, -6.79350, 39.21191, 52.5, 6.0, 90,  'device', now(), 'received', now()),
  ('$C5', '$U_SESS2', 'photo', 'captures/$DAY/demo0002/$C5.jpg', 'image/jpeg', 200000, -6.79800, 39.19300, 40.0, 8.5, 45,  'device', now(), 'received', now());

INSERT INTO gps_fixes (id, capture_id, session_id, lat, lng, altitude, h_accuracy, heading, source, device_ts, server_ts) VALUES
  ('e1000000-0000-0000-0000-0000000000e1', '$C1', '$U_SESS1', -6.79341, 39.21200, 52.0, 4.2, 180, 'device', now(), now()),
  ('e1000000-0000-0000-0000-0000000000e2', '$C2', '$U_SESS1', -6.79350, 39.21209, 51.5, 5.1, 270, 'device', now(), now()),
  ('e1000000-0000-0000-0000-0000000000e3', '$C3', '$U_SESS1', -6.79359, 39.21200, 51.0, 4.8, 0,   'device', now(), now()),
  ('e1000000-0000-0000-0000-0000000000e4', '$C4', '$U_SESS1', -6.79350, 39.21191, 52.5, 6.0, 90,  'device', now(), now()),
  ('e1000000-0000-0000-0000-0000000000e5', '$C5', '$U_SESS2', -6.79800, 39.19300, 40.0, 8.5, 45,  'device', now(), now());

INSERT INTO processing_jobs (type, status, priority, input_ref) VALUES
  ('capture.process', 'pending', 8, '{"captureId":"$C1"}'::jsonb),
  ('capture.process', 'pending', 8, '{"captureId":"$C2"}'::jsonb),
  ('capture.process', 'pending', 8, '{"captureId":"$C3"}'::jsonb),
  ('capture.process', 'pending', 8, '{"captureId":"$C4"}'::jsonb),
  ('capture.process', 'pending', 8, '{"captureId":"$C5"}'::jsonb);
SQL

echo "Seeded: admin $ADMIN_EMAIL, link token KX7M2Q4V9R, 5 demo captures queued."
echo "The worker processes them in ~20s — watch Admin → Processing, then open /map."
