import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { Role } from "@/shared/roles";

// Ids are short random strings made in the app (src/server/ids.ts), so a
// record can be named before it is saved (offline outbox, storage keys).
const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// --- People and access ------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  role: text("role").$type<Role>().notNull().default("travailleur"),
  /** Job title shown beside the name, e.g. "Opérateur de pelle". */
  title: text("title"),
  phone: text("phone"),
  email: text("email"),
  active: boolean("active").notNull().default(true),
  /** Joined with a project QR code and not yet looked at by the office. */
  unreviewed: boolean("unreviewed").notNull().default(false),
  /**
   * How the person made their own account, when they did: "company_code"
   * (the company's code, at /inscription). Null for an account the office
   * made, or one made at a site's QR code (createdBy is then the code's author).
   */
  joinedWith: text("joined_with").$type<"company_code">(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /**
   * When the person deleted their account. The row stays only for someone
   * whose name is on the company's records (reports, photos, documents,
   * plans): it keeps the name, nothing else, and never signs in again.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** One per signed-in device. The cookie holds the token; only its hash is kept. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** "iPhone · Safari", from the browser, to recognise a device in the list. */
    label: text("label"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash").on(t.tokenHash), index("sessions_user").on(t.userId)],
);

/**
 * A way in without a password. "personal": a link for one person, already
 * created by the office. "project": the QR code of a site, which lets a worker
 * add themself to that project.
 */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").$type<"personal" | "project">().notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invites_token_hash").on(t.tokenHash)],
);

/**
 * The app's own settings, one row per setting, changed by the office: who
 * changed it last and when. "company_code": the code that lets a newcomer
 * make their own account (null while account creation is closed).
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per attempt to make an account with the company code that was
 * refused (a wrong code, a number already in use), or that made an account.
 * It is what the door's ceilings are counted from (src/server/signup/door.ts),
 * kept two days. The address is kept as a keyed digest, the code never.
 */
export const signupAttempts = pgTable(
  "signup_attempts",
  {
    id: id(),
    addressHash: text("address_hash").notNull(),
    outcome: text("outcome").$type<"wrong_code" | "phone_taken" | "created">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("signup_attempts_address").on(t.addressHash, t.createdAt),
    index("signup_attempts_outcome").on(t.outcome, t.createdAt),
  ],
);

// --- Projects ---------------------------------------------------------------

export const projects = pgTable("projects", {
  id: id(),
  /** EAD's own project number, e.g. "2026-014". */
  number: text("number"),
  name: text("name").notNull(),
  client: text("client"),
  address: text("address"),
  city: text("city"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  description: text("description"),
  status: text("status").$type<"actif" | "archive">().notNull().default("actif"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user").on(t.userId),
  ],
);

// --- Files ------------------------------------------------------------------

/** A file sent from a browser straight to storage, then confirmed. */
export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"plan" | "document" | "photo">().notNull(),
    /** Key in the private bucket. */
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: text("status").$type<"pending" | "complete">().notNull().default("pending"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("uploads_project").on(t.projectId),
    // A person's allowance of unfinished uploads, and the sweep of old ones.
    index("uploads_author_status").on(t.createdBy, t.status),
    index("uploads_status_created").on(t.status, t.createdAt),
  ],
);

// --- Plans ------------------------------------------------------------------

export const planFolders = pgTable(
  "plan_folders",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("plan_folders_project").on(t.projectId)],
);

/** A sheet of the plan set ("C-101"). What it shows is its current revision. */
export const sheets = pgTable(
  "sheets",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => planFolders.id, { onDelete: "set null" }),
    number: text("number").notNull(),
    title: text("title").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    currentRevisionId: text("current_revision_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("sheets_project").on(t.projectId)],
);

/** A PDF of plans being brought in: read, cut into tiles, checked, published. */
export const planImports = pgTable(
  "plan_imports",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    pageCount: integer("page_count"),
    status: text("status")
      .$type<"reading" | "processing" | "review" | "published" | "failed">()
      .notNull()
      .default("reading"),
    error: text("error"),
    /** When a worker last began reading the PDF: only one reads at a time. */
    readingStartedAt: timestamp("reading_started_at", { withTimezone: true }),
    /** Applied to every sheet of the import at publication. */
    folderId: text("folder_id").references(() => planFolders.id, { onDelete: "set null" }),
    revisionLabel: text("revision_label"),
    issuedOn: date("issued_on"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("plan_imports_project").on(t.projectId)],
);

/**
 * One page of an imported PDF, rendered as a pyramid of image tiles. Until
 * the import is published it belongs to no sheet (sheetId is null) and the
 * draft* columns hold what the office is about to confirm.
 */
export const sheetRevisions = pgTable(
  "sheet_revisions",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sheetId: text("sheet_id").references(() => sheets.id, { onDelete: "cascade" }),
    importId: text("import_id").references(() => planImports.id, { onDelete: "set null" }),
    pageIndex: integer("page_index").notNull(),
    /** "Rév. 2", "B", "Émis pour construction"… free text. */
    label: text("label"),
    issuedOn: date("issued_on"),

    status: text("status")
      .$type<"queued" | "processing" | "ready" | "failed">()
      .notNull()
      .default("queued"),
    error: text("error"),
    /** How many times a worker took this page: one that keeps failing is given up. */
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),

    // The image pyramid, in the public bucket under an unguessable prefix.
    tileKey: text("tile_key"),
    width: integer("width"),
    height: integer("height"),
    tileSize: integer("tile_size"),
    tileOverlap: integer("tile_overlap"),
    /** Text of the page, for search. */
    text: text("text"),

    draftNumber: text("draft_number"),
    draftTitle: text("draft_title"),
    /** An existing sheet this page replaces as a new revision. */
    draftSheetId: text("draft_sheet_id"),
    draftSkip: boolean("draft_skip").notNull().default(false),

    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sheet_revisions_sheet").on(t.sheetId),
    index("sheet_revisions_import").on(t.importId, t.pageIndex),
    index("sheet_revisions_project").on(t.projectId),
  ],
);

// --- Documents --------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("autre"),
    title: text("title").notNull(),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("documents_project").on(t.projectId)],
);

// --- Site photos ------------------------------------------------------------

export const photos = pgTable(
  "photos",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Public bucket, under an unguessable prefix: `${imageKey}/full.jpg`, `/thumb.webp`. */
    imageKey: text("image_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    caption: text("caption"),
    reportId: text("report_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("photos_project_taken").on(t.projectId, t.takenAt)],
);

// --- Daily reports ----------------------------------------------------------

export type ReportWeather = {
  /** "soleil" | "nuageux" | "pluie" | "neige" | "vent" | "brouillard" */
  condition?: string;
  temperatureC?: number | null;
  note?: string;
};
export type ReportCrewLine = { name: string; hours: number | null; userId?: string | null };

export const dailyReports = pgTable(
  "daily_reports",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    weather: jsonb("weather")
      .$type<ReportWeather>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    crew: jsonb("crew")
      .$type<ReportCrewLine[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    equipment: text("equipment").notNull().default(""),
    workDone: text("work_done").notNull().default(""),
    /** Delays, incidents, visitors, instructions received. */
    notes: text("notes").notNull().default(""),
    /** Ids of the project's photos that go with the report, in the order they were added. */
    photoIds: jsonb("photo_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One report per project and per day.
  (t) => [uniqueIndex("daily_reports_project_day").on(t.projectId, t.day)],
);

// --- Assistant ----------------------------------------------------------------

/**
 * One row per call to the paid AI service, kept two days: it is what the
 * allowance per person is counted from (see src/server/ai/usage.ts).
 */
export const assistantUses = pgTable(
  "assistant_uses",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"dictation">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_uses_user_created").on(t.userId, t.createdAt)],
);
