ALTER TABLE "invites" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assistant_consent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invites_user" ON "invites" USING btree ("user_id");