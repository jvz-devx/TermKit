CREATE TABLE "host_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_group_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_group_members" ADD CONSTRAINT "host_group_members_host_group_id_host_groups_id_fk" FOREIGN KEY ("host_group_id") REFERENCES "public"."host_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_group_members" ADD CONSTRAINT "host_group_members_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_groups" ADD CONSTRAINT "host_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_group_members_group_host_unique" ON "host_group_members" USING btree ("host_group_id","host_id");--> statement-breakpoint
CREATE INDEX "host_group_members_group_id_idx" ON "host_group_members" USING btree ("host_group_id");--> statement-breakpoint
CREATE INDEX "host_group_members_host_id_idx" ON "host_group_members" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_groups_user_name_unique" ON "host_groups" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "host_groups_user_id_idx" ON "host_groups" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "host_groups" ("user_id", "name", "metadata", "created_at", "updated_at")
SELECT DISTINCT "hosts"."user_id", trim("hosts"."folder"), '{"source":"folder_migration"}'::jsonb, now(), now()
FROM "hosts"
WHERE "hosts"."folder" IS NOT NULL
	AND trim("hosts"."folder") <> ''
ON CONFLICT ("user_id", "name") DO NOTHING;--> statement-breakpoint
INSERT INTO "host_groups" ("user_id", "name", "metadata", "created_at", "updated_at")
SELECT DISTINCT "hosts"."user_id", "workspaces"."name", '{"source":"workspace_migration"}'::jsonb, now(), now()
FROM "hosts"
INNER JOIN "workspaces" ON "workspaces"."id" = "hosts"."workspace_id"
WHERE "workspaces"."name" IS NOT NULL
	AND trim("workspaces"."name") <> ''
ON CONFLICT ("user_id", "name") DO NOTHING;--> statement-breakpoint
INSERT INTO "host_group_members" ("host_group_id", "host_id", "created_at")
SELECT "host_groups"."id", "hosts"."id", now()
FROM "hosts"
INNER JOIN "host_groups"
	ON "host_groups"."user_id" = "hosts"."user_id"
	AND "host_groups"."name" = trim("hosts"."folder")
WHERE "hosts"."folder" IS NOT NULL
	AND trim("hosts"."folder") <> ''
ON CONFLICT ("host_group_id", "host_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "host_group_members" ("host_group_id", "host_id", "created_at")
SELECT "host_groups"."id", "hosts"."id", now()
FROM "hosts"
INNER JOIN "workspaces" ON "workspaces"."id" = "hosts"."workspace_id"
INNER JOIN "host_groups"
	ON "host_groups"."user_id" = "hosts"."user_id"
	AND "host_groups"."name" = "workspaces"."name"
WHERE "workspaces"."name" IS NOT NULL
	AND trim("workspaces"."name") <> ''
ON CONFLICT ("host_group_id", "host_id") DO NOTHING;--> statement-breakpoint
UPDATE "hosts" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "credentials" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "connection_sessions" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "ssh_tunnel_profiles" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "ssh_tunnel_sessions" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "command_snippets" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "automation_templates" SET "workspace_id" = NULL, "visibility" = 'private' WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "background_jobs" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "approval_requests" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "operation_reasons" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "host_facts" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "host_health" SET "workspace_id" = NULL WHERE "workspace_id" IS NOT NULL;
