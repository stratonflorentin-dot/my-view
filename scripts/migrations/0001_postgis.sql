-- 0001_postgis.sql — production geospatial upgrade (requires the PostGIS
-- extension, which this development sandbox does not ship).
--
-- After applying, switch Drizzle columns to geometry types (drizzle
-- `geometry` from drizzle-orm/pg-core) and replace bbox filters with
-- ST_Intersects. Application logic in src/lib/geo.ts is unchanged.

CREATE EXTENSION IF NOT EXISTS postgis;

-- gps_fixes: native point
ALTER TABLE gps_fixes ADD COLUMN geom geometry(Point, 4326);
UPDATE gps_fixes SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
CREATE INDEX idx_gps_fixes_geom ON gps_fixes USING GIST (geom);

-- captures: native point
ALTER TABLE captures ADD COLUMN geom geometry(Point, 4326);
UPDATE captures SET geom = ST_SetSRID(ST_MakePoint(gps_lng, gps_lat), 4326)
  WHERE gps_lat IS NOT NULL;
CREATE INDEX idx_captures_geom ON captures USING GIST (geom);

-- buildings: native point (center)
ALTER TABLE buildings ADD COLUMN geom geometry(Point, 4326);
UPDATE buildings SET geom = ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326);
CREATE INDEX idx_buildings_geom ON buildings USING GIST (geom);

-- building_versions: footprint polygon (from the JSONB column)
ALTER TABLE building_versions ADD COLUMN footprint_geom geometry(Polygon, 4326);
UPDATE building_versions
SET footprint_geom = ST_SetSRID(
      ST_MakePolygon((footprint->'coordinates'->0)::jsonb::geography::geometry),
      4326)
WHERE footprint IS NOT NULL;
CREATE INDEX idx_versions_footprint_geom ON building_versions USING GIST (footprint_geom);

-- Coverage rollup helper (optional): grid-union of capture density
CREATE OR REPLACE VIEW coverage_cells AS
SELECT
  floor(lng / 0.004)::int AS gx,
  floor(lat / 0.004)::int AS gy,
  count(*) AS n,
  ST_MakeEnvelope(
    gx * 0.004, gy * 0.004,
    (gx + 1) * 0.004, (gy + 1) * 0.004,
    4326
  ) AS cell
FROM gps_fixes
GROUP BY 1, 2;
