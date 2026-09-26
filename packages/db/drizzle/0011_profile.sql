CREATE TABLE "profile" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"bio_preset" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"special_category_consent_version" text,
	"special_category_consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;