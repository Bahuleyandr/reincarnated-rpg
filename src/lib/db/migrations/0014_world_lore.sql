CREATE TABLE "world_lore" (
	"id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"prose" text,
	"embedding" vector(512),
	"salience" real NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_user_id" uuid,
	"source_campaign_id" uuid,
	"source_session_id" uuid,
	"source_location_id" text,
	"source_form_id" text,
	"source_phase" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "world_lore" ADD CONSTRAINT "world_lore_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_lore_salience_idx" ON "world_lore" USING btree ("salience","created_at");--> statement-breakpoint
CREATE INDEX "world_lore_category_idx" ON "world_lore" USING btree ("category");--> statement-breakpoint
CREATE INDEX "world_lore_user_idx" ON "world_lore" USING btree ("source_user_id");