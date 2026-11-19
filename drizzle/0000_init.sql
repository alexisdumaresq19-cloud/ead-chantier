CREATE TABLE "daily_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"day" date NOT NULL,
	"weather" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"crew" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment" text DEFAULT '' NOT NULL,
	"work_done" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category" text DEFAULT 'autre' NOT NULL,
	"title" text NOT NULL,
	"upload_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"image_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"caption" text,
	"report_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"filename" text NOT NULL,
	"page_count" integer,
	"status" text DEFAULT 'reading' NOT NULL,
	"error" text,
	"folder_id" text,
	"revision_label" text,
	"issued_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text,
	"name" text NOT NULL,
	"client" text,
	"address" text,
	"city" text,
	"latitude" text,
	"longitude" text,
	"description" text,
	"status" text DEFAULT 'actif' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sheet_id" text,
	"import_id" text,
	"page_index" integer NOT NULL,
	"label" text,
	"issued_on" date,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"tile_key" text,
	"width" integer,
	"height" integer,
	"tile_size" integer,
	"tile_overlap" integer,
	"text" text,
	"draft_number" text,
	"draft_title" text,
	"draft_sheet_id" text,
	"draft_skip" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"folder_id" text,
	"number" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"current_revision_id" text,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'travailleur' NOT NULL,
	"title" text,
	"phone" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"unreviewed" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_folders" ADD CONSTRAINT "plan_folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_folder_id_plan_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."plan_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_revisions" ADD CONSTRAINT "sheet_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_revisions" ADD CONSTRAINT "sheet_revisions_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_revisions" ADD CONSTRAINT "sheet_revisions_import_id_plan_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."plan_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_folder_id_plan_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."plan_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_reports_project_day" ON "daily_reports" USING btree ("project_id","day");--> statement-breakpoint
CREATE INDEX "documents_project" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "photos_project_taken" ON "photos" USING btree ("project_id","taken_at");--> statement-breakpoint
CREATE INDEX "plan_folders_project" ON "plan_folders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "plan_imports_project" ON "plan_imports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sheet_revisions_sheet" ON "sheet_revisions" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "sheet_revisions_import" ON "sheet_revisions" USING btree ("import_id","page_index");--> statement-breakpoint
CREATE INDEX "sheet_revisions_project" ON "sheet_revisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sheets_project" ON "sheets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "uploads_project" ON "uploads" USING btree ("project_id");