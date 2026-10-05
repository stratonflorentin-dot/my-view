/**
 * MyWorld 3D Map — database schema.
 *
 * NOTE ON GEOSPATIAL: the target production schema stores coordinates as
 * PostGIS geometry columns (see docs/DATABASE.md + scripts/migrations/0001_postgis.sql).
 * This sandbox image ships PostgreSQL without the PostGIS extension, so the
 * Drizzle schema below uses double-precision coordinates + GeoJSON JSONB,
 * with the same column semantics, keeping the swap to PostGIS mechanical.
 */
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ------------------------------ users ------------------------------ */

export const userRole = pgEnum("user_role", ["admin", "contributor", "viewer"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------ contributor links ------------------------- */

export const linkScope = pgEnum("link_scope", ["global", "area", "location"]);

export const contributorLinks = pgTable("contributor_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Public, unguessable token. Internal UUIDs are never exposed in URLs. */
  token: varchar("token", { length: 12 }).notNull().unique(),
  label: varchar("label", { length: 160 }),
  scope: linkScope("scope").notNull().default("global"),
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusM: doublePrecision("radius_m").notNull().default(250),
  allowVideo: boolean("allow_video").notNull().default(true),
  /** null = unlimited submissions */
  maxSubmissions: integer("max_submissions"),
  usedSubmissions: integer("used_submissions").notNull().default(0),
  oneTime: boolean("one_time").notNull().default(false),
  usedSessionId: uuid("used_session_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- capture sessions ------------------------- */

export const captureSessions = pgTable("capture_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkToken: varchar("link_token", { length: 12 }).notNull(),
  contributorName: varchar("contributor_name", { length: 120 }),
  deviceInfo: jsonb("device_info"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/* ------------------------------ captures ---------------------------- */

export const captureKind = pgEnum("capture_kind", ["photo", "video"]);
export const captureStatus = pgEnum("capture_status", [
  "received",
  "processing",
  "processed",
  "rejected",
]);

export const captures = pgTable("captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  kind: captureKind("kind").notNull().default("photo"),
  storageKey: text("storage_key").notNull(),
  mime: varchar("mime", { length: 60 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  /** Extracted EXIF (not trusted as the primary location). */
  exif: jsonb("exif"),
  /** Real measurements: sharpness, brightness, blur, duplicate hash. */
  quality: jsonb("quality"),
  gpsLat: doublePrecision("gps_lat"),
  gpsLng: doublePrecision("gps_lng"),
  gpsAltitude: doublePrecision("gps_altitude"),
  gpsHAccuracy: doublePrecision("gps_h_accuracy"),
  gpsVAccuracy: doublePrecision("gps_v_accuracy"),
  gpsHeading: doublePrecision("gps_heading"),
  gpsSource: text("gps_source"),
  deviceTimestamp: timestamp("device_timestamp", { withTimezone: true }),
  status: captureStatus("status").notNull().default("received"),
  duplicateOf: uuid("duplicate_of"),
  /** Assigned by the grouping stage of the pipeline. */
  buildingId: uuid("building_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Discrete GPS fix records. Kept separate from captures so session-level
 * fixes (e.g. the contributor's live position) can also be recorded.
 */
export const gpsFixes = pgTable("gps_fixes", {
  id: uuid("id").primaryKey().defaultRandom(),
  captureId: uuid("capture_id"),
  sessionId: uuid("session_id"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  altitude: doublePrecision("altitude"),
  hAccuracy: doublePrecision("h_accuracy"),
  vAccuracy: doublePrecision("v_accuracy"),
  heading: doublePrecision("heading"),
  source: text("source").notNull().default("device"),
  deviceTs: timestamp("device_ts", { withTimezone: true }),
  serverTs: timestamp("server_ts", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------ buildings --------------------------- */

export const buildingStatus = pgEnum("building_status", [
  "draft",
  "needs_review",
  "approved",
  "rejected",
]);
export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "estimated",
  "verified",
]);

export const buildings = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  altitude: doublePrecision("altitude"),
  status: buildingStatus("status").notNull().default("needs_review"),
  verification: verificationStatus("verification").notNull().default(
    "estimated",
  ),
  currentVersion: integer("current_version").notNull().default(0),
  /** Free-text "more imagery requested" note, shown to the contributor. */
  requestedImagery: text("requested_imagery"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reconstructionType = pgEnum("reconstruction_type", [
  "estimated_single_image",
  "estimated_multi_view",
  "photogrammetry",
  "neural",
  "manual",
]);
export const engineState = pgEnum("engine_state", [
  "pending",
  "ready",
  "failed",
  "unconfigured",
]);

/**
 * Immutable version history. Every reconstruction creates a new row;
 * buildings.currentVersion points at the active one. Nothing is destroyed.
 */
export const buildingVersions = pgTable("building_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull(),
  version: integer("version").notNull(),
  type: reconstructionType("type").notNull(),
  engine: text("engine").notNull(),
  state: engineState("state").notNull().default("ready"),
  /** Deterministic, documented score in [0,1] — see src/lib/confidence.ts. */
  confidence: real("confidence").notNull().default(0),
  /** GeoJSON Polygon (production: geometry(Polygon,4326)). */
  footprint: jsonb("footprint"),
  heightM: real("height_m"),
  floors: integer("floors"),
  buildingType: text("building_type").notNull().default("unknown"),
  roofType: text("roof_type").notNull().default("unknown"),
  modelUrl: text("model_url"),
  modelFormat: text("model_format"),
  textureUrl: text("texture_url"),
  lod: jsonb("lod"),
  /** Capture ids + per-capture metrics fed into this version. */
  inputs: jsonb("inputs"),
  /** Aggregated metrics: view arcs, sharpness, GPS accuracy, overlap. */
  metrics: jsonb("metrics"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ---------------------------- processing ---------------------------- */

export const jobType = pgEnum("job_type", [
  "capture.process",
  "building.reconstruct",
  "building.publish",
  "video.process",
  "model.optimize",
]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: jobType("type").notNull(),
  status: jobStatus("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(5),
  inputRef: jsonb("input_ref"),
  outputRef: jsonb("output_ref"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  logs: text("logs"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ------------------------------ audit ------------------------------- */

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ----------------------------- settings ----------------------------- */

/** Key/value runtime settings (platform name, visibility, thresholds). */
export const mapSettings = pgTable("map_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
