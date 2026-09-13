CREATE TABLE "matching_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ponds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_nominative" text NOT NULL,
	"name_inessive" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ponds_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ponds" ADD CONSTRAINT "ponds_parent_id_ponds_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ponds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matching_config_key_version_idx" ON "matching_config" USING btree ("key","version");