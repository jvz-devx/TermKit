CREATE TABLE "host_share_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"host_id" uuid,
	"credential_id" uuid,
	"include_credentials" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"host_snapshot" jsonb NOT NULL,
	"credential_name" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_share_invitations" ADD CONSTRAINT "host_share_invitations_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_share_invitations" ADD CONSTRAINT "host_share_invitations_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_share_invitations" ADD CONSTRAINT "host_share_invitations_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_share_invitations" ADD CONSTRAINT "host_share_invitations_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_share_invitations_recipient_status_idx" ON "host_share_invitations" USING btree ("recipient_user_id","status");--> statement-breakpoint
CREATE INDEX "host_share_invitations_sender_user_id_idx" ON "host_share_invitations" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "host_share_invitations_host_id_idx" ON "host_share_invitations" USING btree ("host_id");