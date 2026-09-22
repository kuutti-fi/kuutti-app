CREATE TYPE "public"."account_state" AS ENUM('registered', 'active', 'paused', 'shadow_banned', 'suspended', 'banned', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."identity_standing" AS ENUM('ok', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"state" "account_state" DEFAULT 'registered' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"birth_year" smallint NOT NULL,
	"birth_month" smallint NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hetu_hmac" text NOT NULL,
	"standing" "identity_standing" DEFAULT 'ok' NOT NULL,
	"standing_changed_at" timestamp with time zone,
	"broker_subject" text,
	"broker_session_index" text,
	"broker_token_id" text,
	"authenticated_at" timestamp with time zone,
	"acr" text,
	"amr" text[],
	"deletion_count" integer DEFAULT 0 NOT NULL,
	"reregister_after" timestamp with time zone,
	"refused_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_hetu_hmac_unique" UNIQUE("hetu_hmac")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_one_live_per_identity_idx" ON "account" USING btree ("identity_id") WHERE "account"."state" <> 'deleted';--> statement-breakpoint
CREATE INDEX "account_state_idx" ON "account" USING btree ("state");--> statement-breakpoint
CREATE INDEX "identity_standing_idx" ON "identity" USING btree ("standing");