CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"address_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "joined_with" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "signup_attempts_address" ON "signup_attempts" USING btree ("address_hash","created_at");--> statement-breakpoint
CREATE INDEX "signup_attempts_outcome" ON "signup_attempts" USING btree ("outcome","created_at");