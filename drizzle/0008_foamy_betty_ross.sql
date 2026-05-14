CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."automation_template_kind" AS ENUM('ssh_command', 'file_transfer', 'ssh_tunnel', 'rdp_checklist', 'operator_note');--> statement-breakpoint
CREATE TYPE "public"."automation_template_visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."automation_variable_kind" AS ENUM('string', 'number', 'boolean', 'enum', 'secret_ref', 'path');--> statement-breakpoint
CREATE TYPE "public"."background_job_kind" AS ENUM('template_run', 'bulk_ssh_command', 'bulk_file_transfer', 'bulk_host_edit', 'inventory_check');--> statement-breakpoint
CREATE TYPE "public"."background_job_status" AS ENUM('pending', 'queued', 'running', 'cancelling', 'cancelled', 'completed', 'completed_with_errors', 'failed');--> statement-breakpoint
CREATE TYPE "public"."host_fact_source" AS ENUM('ssh', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."host_health_state" AS ENUM('unknown', 'healthy', 'stale', 'unreachable', 'auth_failed', 'degraded', 'never_used');--> statement-breakpoint
CREATE TYPE "public"."job_event_severity" AS ENUM('debug', 'info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_report_format" AS ENUM('json', 'csv');--> statement-breakpoint
CREATE TYPE "public"."job_target_status" AS ENUM('pending', 'queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelling', 'cancelled', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."workspace_policy_capability" AS ENUM('launch_session', 'file_transfer', 'ssh_tunnel', 'terminal_recording', 'rdp_clipboard', 'rdp_audio', 'automation_template', 'bulk_job', 'host_facts');--> statement-breakpoint
CREATE TYPE "public"."workspace_policy_effect" AS ENUM('allow', 'deny', 'approval_required', 'reason_required');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"job_id" uuid,
	"template_id" uuid,
	"capability" "workspace_policy_capability" NOT NULL,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"reason" text,
	"decision_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"kind" "automation_template_kind" NOT NULL,
	"visibility" "automation_template_visibility" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_dangerous" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"template_id" uuid,
	"template_version" integer,
	"kind" "background_job_kind" NOT NULL,
	"status" "background_job_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"cancellation_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"workspace_id" uuid,
	"collected_by" uuid,
	"source" "host_fact_source" DEFAULT 'ssh' NOT NULL,
	"os_name" text,
	"os_version" text,
	"kernel" text,
	"uptime_seconds" integer,
	"cpu" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disk" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"service_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"workspace_id" uuid,
	"state" "host_health_state" DEFAULT 'unknown' NOT NULL,
	"last_successful_connection_at" timestamp with time zone,
	"last_failed_connection_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_check_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"target_id" uuid,
	"severity" "job_event_severity" DEFAULT 'info' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"format" "job_report_format" NOT NULL,
	"storage_key" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"host_id" uuid,
	"status" "job_target_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid NOT NULL,
	"host_id" uuid,
	"job_id" uuid,
	"template_id" uuid,
	"capability" "workspace_policy_capability" NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"capability" "workspace_policy_capability" NOT NULL,
	"effect" "workspace_policy_effect" DEFAULT 'allow' NOT NULL,
	"minimum_role" text DEFAULT 'owner' NOT NULL,
	"max_targets" integer,
	"require_reason" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_template_id_automation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."automation_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_template_id_automation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."automation_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_facts" ADD CONSTRAINT "host_facts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_facts" ADD CONSTRAINT "host_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_facts" ADD CONSTRAINT "host_facts_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health" ADD CONSTRAINT "host_health_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_health" ADD CONSTRAINT "host_health_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_target_id_job_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."job_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_targets" ADD CONSTRAINT "job_targets_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_targets" ADD CONSTRAINT "job_targets_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_reasons" ADD CONSTRAINT "operation_reasons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_reasons" ADD CONSTRAINT "operation_reasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_reasons" ADD CONSTRAINT "operation_reasons_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_reasons" ADD CONSTRAINT "operation_reasons_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_reasons" ADD CONSTRAINT "operation_reasons_template_id_automation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."automation_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_policies" ADD CONSTRAINT "workspace_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_id_idx" ON "approval_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "approval_requests_job_id_idx" ON "approval_requests" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "approval_requests_template_id_idx" ON "approval_requests" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "approval_requests_requested_by_idx" ON "approval_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_expires_at_idx" ON "approval_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "automation_templates_user_id_idx" ON "automation_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_templates_workspace_id_idx" ON "automation_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "automation_templates_kind_idx" ON "automation_templates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "automation_templates_visibility_idx" ON "automation_templates" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "background_jobs_user_id_idx" ON "background_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "background_jobs_workspace_id_idx" ON "background_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "background_jobs_template_id_idx" ON "background_jobs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "background_jobs_kind_idx" ON "background_jobs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "background_jobs_retention_expires_at_idx" ON "background_jobs" USING btree ("retention_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_facts_host_unique" ON "host_facts" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_facts_workspace_id_idx" ON "host_facts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "host_facts_collected_by_idx" ON "host_facts" USING btree ("collected_by");--> statement-breakpoint
CREATE INDEX "host_facts_source_idx" ON "host_facts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "host_facts_collected_at_idx" ON "host_facts" USING btree ("collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_health_host_unique" ON "host_health" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_health_workspace_id_idx" ON "host_health" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "host_health_state_idx" ON "host_health" USING btree ("state");--> statement-breakpoint
CREATE INDEX "host_health_checked_at_idx" ON "host_health" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "host_health_next_check_at_idx" ON "host_health" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "job_events_job_id_idx" ON "job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_events_target_id_idx" ON "job_events" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "job_events_severity_idx" ON "job_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "job_events_created_at_idx" ON "job_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_reports_job_id_idx" ON "job_reports" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_reports_generated_by_idx" ON "job_reports" USING btree ("generated_by");--> statement-breakpoint
CREATE INDEX "job_reports_expires_at_idx" ON "job_reports" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_targets_job_host_unique" ON "job_targets" USING btree ("job_id","host_id");--> statement-breakpoint
CREATE INDEX "job_targets_job_id_idx" ON "job_targets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_targets_host_id_idx" ON "job_targets" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "job_targets_status_idx" ON "job_targets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operation_reasons_workspace_id_idx" ON "operation_reasons" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "operation_reasons_user_id_idx" ON "operation_reasons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "operation_reasons_host_id_idx" ON "operation_reasons" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "operation_reasons_job_id_idx" ON "operation_reasons" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "operation_reasons_template_id_idx" ON "operation_reasons" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "operation_reasons_capability_idx" ON "operation_reasons" USING btree ("capability");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_policies_workspace_capability_unique" ON "workspace_policies" USING btree ("workspace_id","capability");--> statement-breakpoint
CREATE INDEX "workspace_policies_workspace_id_idx" ON "workspace_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_policies_capability_idx" ON "workspace_policies" USING btree ("capability");