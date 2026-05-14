CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_sessions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_workspace_user_unique" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_workspace_id_idx" ON "workspace_memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_name_idx" ON "workspaces" USING btree ("name");--> statement-breakpoint
ALTER TABLE "connection_sessions" ADD CONSTRAINT "connection_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_sessions_workspace_id_idx" ON "connection_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credentials_workspace_id_idx" ON "credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "hosts_workspace_id_idx" ON "hosts" USING btree ("workspace_id");