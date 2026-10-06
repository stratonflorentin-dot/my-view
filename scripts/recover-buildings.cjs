// One-off recovery: recreate buildings for orphaned captures, then enqueue
// real building.reconstruct jobs (drained by the app's worker).
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const caps = (
    await p.query(
      `select c.id, c.gps_lat, c.gps_lng, c.gps_altitude, c.session_id, s.project_id
       from captures c left join capture_sessions s on s.id = c.session_id
       where c.building_id is null and c.status = 'processed'
         and c.kind = 'photo' and c.gps_lat is not null and c.gps_lng is not null`,
    )
  ).rows;
  console.log("orphaned processed captures:", caps.length);

  let created = 0,
    attached = 0;
  for (const c of caps) {
    const blds = (
      await p.query(
        `select id, center_lat, center_lng from buildings
         where ${c.project_id ? "project_id = $1" : "project_id is null"}`,
        c.project_id ? [c.project_id] : [],
      )
    ).rows;
    let best = null,
      bestD = Infinity;
    for (const b of blds) {
      const d = haversineM(
        { lat: c.gps_lat, lng: c.gps_lng },
        { lat: b.center_lat, lng: b.center_lng },
      );
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    let buildingId;
    if (best && bestD <= 35) {
      buildingId = best.id;
      attached++;
    } else {
      const ins = await p.query(
        `insert into buildings (name, project_id, center_lat, center_lng, altitude, status)
         values ($1, $2, $3, $4, $5, 'draft') returning id`,
        [
          `Building ${c.id.slice(0, 8).toUpperCase()}`,
          c.project_id,
          c.gps_lat,
          c.gps_lng,
          c.gps_altitude,
        ],
      );
      buildingId = ins.rows[0].id;
      created++;
    }
    await p.query(`update captures set building_id = $1 where id = $2`, [
      buildingId,
      c.id,
    ]);
  }
  console.log("buildings created:", created, "captures attached:", attached);

  const bids = (
    await p.query(
      `select distinct building_id id from captures where building_id is not null`,
    )
  ).rows;
  for (const b of bids) {
    await p.query(
      `insert into processing_jobs (type, status, priority, input_ref)
       values ('building.reconstruct', 'pending', 6, $1)`,
      [JSON.stringify({ buildingId: b.id })],
    );
  }
  console.log("reconstruct jobs enqueued:", bids.length);
  await p.end();
})().catch((e) => {
  console.error("RECOVER FAIL:", e.message);
  process.exit(1);
});
