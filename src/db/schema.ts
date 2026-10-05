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
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
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
export const fenceType = pgEnum("fence_type", ["circle", "polygon", "rectangle"]);
export const sessionKind = pgEnum("session_kind", ["building", "area"]);

export const contributorLinks = pgTable("contributor_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Owning map project. Null only for pre-multi-tenancy links. */
  projectId: uuid("project_id"),
  /** Public, unguessable token. Internal UUIDs are never exposed in URLs. */
  token: varchar("token", { length: 12 }).notNull().unique(),
  label: varchar("label", { length: 160 }),
  scope: linkScope("scope").notNull().default("global"),
  /** Geo-fence: circle (center+radius), rectangle or polygon (GeoJSON). */
  fenceType: fenceType("fence_type").notNull().default("circle"),
  polygon: jsonb("polygon"),
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusM: doublePrecision("radius_m").notNull().default(250),
  /** Contributor permission switches (all re-validated server-side). */
  requireLogin: boolean("require_login").notNull().default(false),
  requireGps: boolean("require_gps").notNull().default(true),
  minGpsAccuracyM: doublePrecision("min_gps_accuracy_m"),
  allowPhotos: boolean("allow_photos").notNull().default(true),
  allowVideo: boolean("allow_video").notNull().default(true),
  allowBuildingScan: boolean("allow_building_scan").notNull().default(true),
  allowAreaScan: boolean("allow_area_scan").notNull().default(false),
  requireApproval: boolean("require_approval").notNull().default(true),
  autoPublish: boolean("auto_publish").notNull().default(false),
  /** Optional custom form (forms.id) shown to contributors. */
  formId: uuid("form_id"),
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
  projectId: uuid("project_id"),
  /** building = one structure; area = walk-around, many objects. */
  kind: sessionKind("kind").notNull().default("building"),
  contributorName: varchar("contributor_name", { length: 120 }),
  userId: uuid("user_id"),
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
  projectId: uuid("project_id"),
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
  "webhook.deliver",
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

/* ---------------------------- projects ----------------------------- */

export const projectVisibility = pgEnum("project_visibility", [
  "private",
  "invitation_only",
  "shared",
  "public",
  "api_only",
]);

/**
 * A map project is the top-level multi-tenant unit. Every scan link,
 * session, capture, building, submission and map object belongs to one.
 * Legacy rows (created before multi-tenancy) have project_id = null and
 * remain visible to platform admins only.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    description: text("description"),
    visibility: projectVisibility("visibility").notNull().default("private"),
    centerLat: doublePrecision("center_lat"),
    centerLng: doublePrecision("center_lng"),
    defaultZoom: integer("default_zoom").notNull().default(15),
    planId: uuid("plan_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_slug_idx").on(t.slug), index("projects_owner_idx").on(t.ownerId)],
);

export const memberRole = pgEnum("member_role", [
  "owner",
  "editor",
  "contributor",
  "viewer",
]);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: memberRole("role").notNull().default("viewer"),
    invitedBy: uuid("invited_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_members_unique").on(t.projectId, t.userId)],
);

/* ------------------------------ plans ------------------------------- */

/**
 * Billing scaffolding: plans define quotas and limits. No payment is
 * required initially; administrators create Free/Developer/Business/
 * Enterprise plans and assign them to projects.
 */
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  monthlyRequestQuota: integer("monthly_request_quota").notNull().default(10000),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  maxProjects: integer("max_projects").notNull().default(3),
  maxStorageMb: integer("max_storage_mb").notNull().default(1024),
  priceCents: integer("price_cents").notNull().default(0),
  features: jsonb("features").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------ forms ------------------------------- */

export type FormField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "phone" | "email" | "url";
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

/** Flexible per-project form definitions. Values are stored as JSONB on
 * submissions — custom fields never require database schema changes. */
export const forms = pgTable("forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  fields: jsonb("fields").$type<FormField[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------- submissions ---------------------------- */

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "approved",
  "rejected",
  "needs_imagery",
]);
export const submissionKind = pgEnum("submission_kind", [
  "building",
  "location",
  "area",
]);

/**
 * A submission is the reviewable unit: one capture session + location form
 * + photos, contributed through one scan link. Approval promotes it into
 * map object(s) and/or a building on the owning project's map.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"),
    sessionId: uuid("session_id").notNull(),
    linkToken: varchar("link_token", { length: 12 }),
    contributorName: varchar("contributor_name", { length: 120 }),
    userId: uuid("user_id"),
    kind: submissionKind("kind").notNull().default("building"),
    name: varchar("name", { length: 200 }),
    category: varchar("category", { length: 80 }),
    description: text("description"),
    address: text("address"),
    /** Location-form + custom-form answers, validated against the project form. */
    formData: jsonb("form_data"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Building anchor assigned by the grouping pipeline, if any. */
    buildingId: uuid("building_id"),
    objectId: uuid("object_id"),
    captureCount: integer("capture_count").notNull().default(0),
    status: submissionStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("submissions_project_idx").on(t.projectId, t.status),
    index("submissions_session_idx").on(t.sessionId),
  ],
);

/* ---------------------------- map objects --------------------------- */

export const objectType = pgEnum("object_type", [
  "building",
  "location",
  "road",
  "landmark",
  "business",
  "property",
  "warehouse",
  "infrastructure",
  "construction",
  "poi",
  "area",
  "model",
]);
export const objectVerification = pgEnum("object_verification", [
  "unverified",
  "estimated",
  "verified",
]);
export const objectStatus = pgEnum("object_status", ["draft", "published", "archived"]);

/**
 * Generic map object layer. Geometry is GeoJSON (Point/LineString/Polygon).
 * Buildings created by the capture pipeline reference buildingId; objects
 * approved from submissions are created here with full provenance.
 */
export const mapObjects = pgTable(
  "map_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    type: objectType("type").notNull().default("location"),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    geometry: jsonb("geometry").notNull(),
    properties: jsonb("properties").notNull().default({}),
    /** Object-storage keys of attached images (metadata only). */
    images: jsonb("images").notNull().default([]),
    buildingId: uuid("building_id"),
    sourceSubmissionId: uuid("source_submission_id"),
    confidence: real("confidence").notNull().default(0),
    verification: objectVerification("verification").notNull().default("unverified"),
    status: objectStatus("status").notNull().default("published"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("map_objects_project_idx").on(t.projectId, t.type),
    index("map_objects_building_idx").on(t.buildingId),
  ],
);

/* ----------------------------- API keys ----------------------------- */

export const apiKeyStatus = pgEnum("api_key_status", ["active", "revoked"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** mk_public_… — safe to expose; identifies the key in logs. */
    publicKey: varchar("public_key", { length: 64 }).notNull().unique(),
    /** sha256 of mk_secret_… — the raw secret is shown once, never stored. */
    secretHash: text("secret_hash").notNull(),
    secretPrefix: varchar("secret_prefix", { length: 16 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: apiKeyStatus("status").notNull().default("active"),
    /** Per-key rate limit override (requests/minute); null = plan default. */
    rateLimitPerMin: integer("rate_limit_per_min"),
    allowedIps: jsonb("allowed_ips").$type<string[]>().notNull().default([]),
    /** Optional browser origins allowed to use the public key. */
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_project_idx").on(t.projectId)],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id").notNull(),
    projectId: uuid("project_id").notNull(),
    route: varchar("route", { length: 160 }).notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    statusCode: integer("status_code").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_usage_key_idx").on(t.keyId, t.createdAt),
    index("api_usage_project_idx").on(t.projectId, t.createdAt),
  ],
);

/* ----------------------------- webhooks ----------------------------- */

export const webhookStatus = pgEnum("webhook_status", ["active", "disabled"]);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  url: text("url").notNull(),
  /** HMAC-SHA256 signing secret; deliveries carry X-MyMap-Signature. */
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  status: webhookStatus("status").notNull().default("active"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id").notNull(),
    event: varchar("event", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt)],
);

/* ------------------------------ settings ----------------------------- */

/** Key/value runtime settings (platform name, visibility, thresholds). */
export const mapSettings = pgTable("map_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
