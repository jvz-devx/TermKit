CREATE TYPE "public"."file_transfer_protocol" AS ENUM('sftp', 'ftp', 'ftps');--> statement-breakpoint
CREATE TYPE "public"."ftps_mode" AS ENUM('explicit', 'implicit');--> statement-breakpoint
CREATE TYPE "public"."terminal_recording_status" AS ENUM('recording', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "command_snippets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"host_id" uuid,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"protocol" "file_transfer_protocol" NOT NULL,
	"label" text NOT NULL,
	"remote_path" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ftps_host_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"mode" "ftps_mode" DEFAULT 'explicit' NOT NULL,
	"reject_unauthorized" boolean DEFAULT true NOT NULL,
	"certificate_hostname" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rdp_host_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"clipboard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audio" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gateway" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"font_size" integer DEFAULT 13 NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"scrollback_lines" integer DEFAULT 2000 NOT NULL,
	"shell_title" text,
	"initial_cols" integer DEFAULT 120 NOT NULL,
	"initial_rows" integer DEFAULT 32 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"connection_session_id" uuid,
	"ssh_live_session_id" uuid,
	"status" "terminal_recording_status" DEFAULT 'recording' NOT NULL,
	"storage_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_snippets" ADD CONSTRAINT "command_snippets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_snippets" ADD CONSTRAINT "command_snippets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_snippets" ADD CONSTRAINT "command_snippets_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_bookmarks" ADD CONSTRAINT "file_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_bookmarks" ADD CONSTRAINT "file_bookmarks_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftps_host_settings" ADD CONSTRAINT "ftps_host_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftps_host_settings" ADD CONSTRAINT "ftps_host_settings_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdp_host_settings" ADD CONSTRAINT "rdp_host_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdp_host_settings" ADD CONSTRAINT "rdp_host_settings_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_preferences" ADD CONSTRAINT "terminal_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_preferences" ADD CONSTRAINT "terminal_preferences_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_connection_session_id_connection_sessions_id_fk" FOREIGN KEY ("connection_session_id") REFERENCES "public"."connection_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_ssh_live_session_id_ssh_live_sessions_id_fk" FOREIGN KEY ("ssh_live_session_id") REFERENCES "public"."ssh_live_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "command_snippets_user_id_idx" ON "command_snippets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "command_snippets_workspace_id_idx" ON "command_snippets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "command_snippets_host_id_idx" ON "command_snippets" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_bookmarks_user_host_path_unique" ON "file_bookmarks" USING btree ("user_id","host_id","remote_path");--> statement-breakpoint
CREATE INDEX "file_bookmarks_user_id_idx" ON "file_bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_bookmarks_host_id_idx" ON "file_bookmarks" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "file_bookmarks_protocol_idx" ON "file_bookmarks" USING btree ("protocol");--> statement-breakpoint
CREATE UNIQUE INDEX "ftps_host_settings_user_host_unique" ON "ftps_host_settings" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "ftps_host_settings_user_id_idx" ON "ftps_host_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ftps_host_settings_host_id_idx" ON "ftps_host_settings" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rdp_host_settings_user_host_unique" ON "rdp_host_settings" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "rdp_host_settings_user_id_idx" ON "rdp_host_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rdp_host_settings_host_id_idx" ON "rdp_host_settings" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_preferences_user_host_unique" ON "terminal_preferences" USING btree ("user_id","host_id");--> statement-breakpoint
CREATE INDEX "terminal_preferences_user_id_idx" ON "terminal_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "terminal_preferences_host_id_idx" ON "terminal_preferences" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_user_id_idx" ON "terminal_recordings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_host_id_idx" ON "terminal_recordings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_connection_session_id_idx" ON "terminal_recordings" USING btree ("connection_session_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_ssh_live_session_id_idx" ON "terminal_recordings" USING btree ("ssh_live_session_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_status_idx" ON "terminal_recordings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "terminal_recordings_retention_expires_at_idx" ON "terminal_recordings" USING btree ("retention_expires_at");