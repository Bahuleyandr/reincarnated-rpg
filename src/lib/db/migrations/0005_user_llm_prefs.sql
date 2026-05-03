CREATE TABLE "user_llm_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preset_id" text NOT NULL,
	"provider_kind" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"api_key_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_llm_prefs" ADD CONSTRAINT "user_llm_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;