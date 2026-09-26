CREATE TYPE "public"."consent_kind" AS ENUM('terms', 'privacy', 'research');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('woman', 'man', 'non_binary');--> statement-breakpoint
CREATE TYPE "public"."preference_mode" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"version" text NOT NULL,
	"locale_shown" text NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"mode" "preference_mode" NOT NULL,
	"include_unknown" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "pond_id" uuid;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_account_kind_idx" ON "consent" USING btree ("account_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_account_field_idx" ON "preferences" USING btree ("account_id","field");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_pond_id_ponds_id_fk" FOREIGN KEY ("pond_id") REFERENCES "public"."ponds"("id") ON DELETE no action ON UPDATE no action;