ALTER TABLE "ai_calls" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "preset_id" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_user_idx" ON "ai_calls" USING btree ("user_id");