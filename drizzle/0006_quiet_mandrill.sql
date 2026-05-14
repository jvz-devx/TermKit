CREATE TYPE "public"."connection_protocol" AS ENUM('ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps', 'ssh_tunnel');--> statement-breakpoint
CREATE TYPE "public"."ssh_tunnel_session_status" AS ENUM('starting', 'active', 'idle', 'ended', 'failed', 'expired');--> statement-breakpoint
ALTER TYPE "public"."host_protocol" ADD VALUE 'ftp';--> statement-breakpoint
ALTER TYPE "public"."host_protocol" ADD VALUE 'ftps';--> statement-breakpoint
CREATE TABLE "ssh_tunnel_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"ssh_host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_host" text NOT NULL,
	"target_port" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_tunnel_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"ssh_host_id" uuid,
	"target_host" text NOT NULL,
	"target_port" integer NOT NULL,
	"public_path" text NOT NULL,
	"status" "ssh_tunnel_session_status" DEFAULT 'starting' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "workspace_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"layout_kind" text NOT NULL,
	"panes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_sessions" ALTER COLUMN "protocol" SET DATA TYPE "public"."connection_protocol" USING "protocol"::text::"public"."connection_protocol";--> statement-breakpoint
ALTER TABLE "connection_sessions" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "connection_sessions" ADD COLUMN "error_details" jsonb;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_profiles" ADD CONSTRAINT "ssh_tunnel_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_profiles" ADD CONSTRAINT "ssh_tunnel_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_profiles" ADD CONSTRAINT "ssh_tunnel_profiles_ssh_host_id_hosts_id_fk" FOREIGN KEY ("ssh_host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_sessions" ADD CONSTRAINT "ssh_tunnel_sessions_profile_id_ssh_tunnel_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ssh_tunnel_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_sessions" ADD CONSTRAINT "ssh_tunnel_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_sessions" ADD CONSTRAINT "ssh_tunnel_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_tunnel_sessions" ADD CONSTRAINT "ssh_tunnel_sessions_ssh_host_id_hosts_id_fk" FOREIGN KEY ("ssh_host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_layouts" ADD CONSTRAINT "workspace_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_layouts" ADD CONSTRAINT "workspace_layouts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssh_tunnel_profiles_user_id_idx" ON "ssh_tunnel_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_profiles_workspace_id_idx" ON "ssh_tunnel_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_profiles_ssh_host_id_idx" ON "ssh_tunnel_profiles" USING btree ("ssh_host_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_profile_id_idx" ON "ssh_tunnel_sessions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_user_id_idx" ON "ssh_tunnel_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_workspace_id_idx" ON "ssh_tunnel_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_ssh_host_id_idx" ON "ssh_tunnel_sessions" USING btree ("ssh_host_id");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_status_idx" ON "ssh_tunnel_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ssh_tunnel_sessions_last_seen_at_idx" ON "ssh_tunnel_sessions" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "workspace_layouts_user_id_idx" ON "workspace_layouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_layouts_workspace_id_idx" ON "workspace_layouts" USING btree ("workspace_id");
