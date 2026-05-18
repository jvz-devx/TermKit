CREATE TABLE "microsoft_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsoft_invitations" ADD CONSTRAINT "microsoft_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_invitations" ADD CONSTRAINT "microsoft_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_invitations_email_unique" ON "microsoft_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "microsoft_invitations_invited_by_user_id_idx" ON "microsoft_invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "microsoft_invitations_accepted_user_id_idx" ON "microsoft_invitations" USING btree ("accepted_user_id");--> statement-breakpoint
CREATE INDEX "microsoft_invitations_revoked_at_idx" ON "microsoft_invitations" USING btree ("revoked_at");