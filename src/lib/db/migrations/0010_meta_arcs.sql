CREATE TABLE "meta_arcs" (
	"id" text PRIMARY KEY NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'stirring' NOT NULL,
	"phase_label" text DEFAULT 'Stirring' NOT NULL,
	"total_feeds" integer DEFAULT 0 NOT NULL,
	"total_starves" integer DEFAULT 0 NOT NULL,
	"contributor_count" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"arc_id" text NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"campaign_id" uuid,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"prose" text,
	"form_id" text,
	"location_id" text,
	"phase_at_contribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_contributions" ADD CONSTRAINT "meta_contributions_arc_id_meta_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."meta_arcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_contributions" ADD CONSTRAINT "meta_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_contributions" ADD CONSTRAINT "meta_contributions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_contributions" ADD CONSTRAINT "meta_contributions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_contributions_arc_idx" ON "meta_contributions" USING btree ("arc_id","created_at");--> statement-breakpoint
CREATE INDEX "meta_contributions_user_idx" ON "meta_contributions" USING btree ("user_id");