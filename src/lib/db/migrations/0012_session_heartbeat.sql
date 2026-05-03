ALTER TABLE "sessions" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sessions_last_active_idx" ON "sessions" USING btree ("last_active_at");