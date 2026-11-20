DROP INDEX "daily_reports_project_day";--> statement-breakpoint
ALTER TABLE "plan_imports" ADD COLUMN "reading_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sheet_revisions" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "uploads_author_status" ON "uploads" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "uploads_status_created" ON "uploads" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_project_day" ON "daily_reports" USING btree ("project_id","day");