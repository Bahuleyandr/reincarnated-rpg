ALTER TABLE "sessions" ADD COLUMN "streak_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "streak_last_day_utc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "streak_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "streak_last_day_utc" text;