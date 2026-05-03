CREATE TABLE "room_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"room_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"text" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"form_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_messages_room_created_idx" ON "room_messages" USING btree ("location_id","room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_messages_session_idx" ON "room_messages" USING btree ("session_id");