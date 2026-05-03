CREATE TABLE "world_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"embedding" vector(512),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"salience" real DEFAULT 0.5 NOT NULL,
	"source_campaign_id" uuid,
	"source_form_id" text,
	"source_location_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_npcs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"relationship_score" integer DEFAULT 0 NOT NULL,
	"memory_summary" text,
	"last_seen_status" text DEFAULT 'alive' NOT NULL,
	"times_met" integer DEFAULT 1 NOT NULL,
	"times_helped" integer DEFAULT 0 NOT NULL,
	"times_harmed" integer DEFAULT 0 NOT NULL,
	"first_met_campaign_id" uuid,
	"last_seen_campaign_id" uuid,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_memories" ADD CONSTRAINT "world_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_npcs" ADD CONSTRAINT "world_npcs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_memories_user_idx" ON "world_memories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_npcs_user_slug_uniq" ON "world_npcs" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "world_npcs_user_idx" ON "world_npcs" USING btree ("user_id");