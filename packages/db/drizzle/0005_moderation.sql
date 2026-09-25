CREATE TYPE "public"."moderator_role" AS ENUM('moderator', 'admin', 'researcher');--> statement-breakpoint
CREATE TYPE "public"."photo_decision" AS ENUM('approved', 'queued', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."photo_rejection_reason" AS ENUM('nudity', 'no_person', 'several_people', 'minor', 'violence', 'contact_details', 'other');--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"role" "moderator_role" NOT NULL,
	"access_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_session_access_hash_unique" UNIQUE("access_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "moderator_roles" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"role" "moderator_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_review" (
	"photo_id" uuid PRIMARY KEY NOT NULL,
	"labels" jsonb NOT NULL,
	"faces" integer NOT NULL,
	"flagged" text[] NOT NULL,
	"model_version" text,
	"checked_at" timestamp with time zone,
	"decision" "photo_decision" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" "photo_rejection_reason"
);
--> statement-breakpoint
ALTER TABLE "auth_request" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "rejection_reason" "photo_rejection_reason";--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_identity_id_identity_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_roles" ADD CONSTRAINT "moderator_roles_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_review" ADD CONSTRAINT "photo_review_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_review" ADD CONSTRAINT "photo_review_decided_by_identity_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_session_identity_idx" ON "admin_session" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_at_idx" ON "audit_log" USING btree ("actor_identity_id","at");--> statement-breakpoint
CREATE INDEX "photo_review_decision_idx" ON "photo_review" USING btree ("decision","checked_at");--> statement-breakpoint
ALTER TABLE "auth_request" ADD CONSTRAINT "auth_request_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;