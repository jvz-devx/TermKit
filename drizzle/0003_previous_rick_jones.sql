CREATE TYPE "public"."ssh_live_session_status" AS ENUM('starting', 'attached', 'detached', 'ended', 'failed', 'stale');--> statement-breakpoint
CREATE TABLE "ssh_attach_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ssh_live_session_id" uuid NOT NULL,
	"ticket_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "ssh_live_session_status" DEFAULT 'starting' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attached_at" timestamp with time zone,
	"detached_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"terminal_cols" integer NOT NULL,
	"terminal_rows" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_attach_tickets" ADD CONSTRAINT "ssh_attach_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_attach_tickets" ADD CONSTRAINT "ssh_attach_tickets_ssh_live_session_id_ssh_live_sessions_id_fk" FOREIGN KEY ("ssh_live_session_id") REFERENCES "public"."ssh_live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_live_sessions" ADD CONSTRAINT "ssh_live_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_live_sessions" ADD CONSTRAINT "ssh_live_sessions_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_attach_tickets_ticket_hash_unique" ON "ssh_attach_tickets" USING btree ("ticket_hash");--> statement-breakpoint
CREATE INDEX "ssh_attach_tickets_user_id_idx" ON "ssh_attach_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssh_attach_tickets_ssh_live_session_id_idx" ON "ssh_attach_tickets" USING btree ("ssh_live_session_id");--> statement-breakpoint
CREATE INDEX "ssh_attach_tickets_expires_at_idx" ON "ssh_attach_tickets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ssh_live_sessions_user_id_idx" ON "ssh_live_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssh_live_sessions_host_id_idx" ON "ssh_live_sessions" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "ssh_live_sessions_status_idx" ON "ssh_live_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ssh_live_sessions_expires_at_idx" ON "ssh_live_sessions" USING btree ("expires_at");