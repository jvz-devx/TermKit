CREATE TYPE "public"."rdp_live_session_status" AS ENUM('active', 'detached', 'ended', 'failed');--> statement-breakpoint
CREATE TABLE "rdp_live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "rdp_live_session_status" DEFAULT 'detached' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attached_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_layouts" ADD COLUMN "tree" jsonb;--> statement-breakpoint
ALTER TABLE "rdp_live_sessions" ADD CONSTRAINT "rdp_live_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdp_live_sessions" ADD CONSTRAINT "rdp_live_sessions_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rdp_live_sessions_user_id_idx" ON "rdp_live_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rdp_live_sessions_host_id_idx" ON "rdp_live_sessions" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "rdp_live_sessions_status_idx" ON "rdp_live_sessions" USING btree ("status");