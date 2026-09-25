CREATE TYPE "public"."photo_state" AS ENUM('pending', 'approved', 'queued', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."photo_variant" AS ENUM('thumb', 'card', 'full');--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"blurhash" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"state" "photo_state" DEFAULT 'pending' NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"variant" "photo_variant" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_access" ADD CONSTRAINT "photo_access_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_account_position_idx" ON "photo" USING btree ("account_id","position");--> statement-breakpoint
CREATE INDEX "photo_key_idx" ON "photo" USING btree ("key");--> statement-breakpoint
CREATE INDEX "photo_access_account_at_idx" ON "photo_access" USING btree ("account_id","at");