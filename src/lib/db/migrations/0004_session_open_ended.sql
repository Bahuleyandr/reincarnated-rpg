ALTER TABLE "sessions" ADD COLUMN "location_id" text DEFAULT 'collapsed-tunnel' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reincarnated_as" text;