CREATE TABLE "research_subject" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"research_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"consent_version" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_subject_research_id_unique" UNIQUE("research_id")
);
--> statement-breakpoint
ALTER TABLE "research_subject" ADD CONSTRAINT "research_subject_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;