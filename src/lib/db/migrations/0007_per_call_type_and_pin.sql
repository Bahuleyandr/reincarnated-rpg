ALTER TABLE "campaigns" ADD COLUMN "pinned_preset_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "pinned_narration_model" text;--> statement-breakpoint
ALTER TABLE "user_llm_prefs" ADD COLUMN "classifier_model" text;--> statement-breakpoint
ALTER TABLE "user_llm_prefs" ADD COLUMN "tone_model" text;--> statement-breakpoint
ALTER TABLE "user_llm_prefs" ADD COLUMN "use_llm_classifier" text DEFAULT 'false' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_llm_prefs" ADD COLUMN "use_llm_tone" text DEFAULT 'false' NOT NULL;