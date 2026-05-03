ALTER TABLE "sessions" ADD COLUMN "energy" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "energy_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "energy" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "energy_updated_at" timestamp with time zone DEFAULT now() NOT NULL;