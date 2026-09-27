CREATE TABLE "waitlist_snapshot" (
	"pond_id" uuid PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"verified" integer NOT NULL,
	"woman" integer NOT NULL,
	"man" integer NOT NULL,
	"non_binary" integer NOT NULL,
	"finishing" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_snapshot" ADD CONSTRAINT "waitlist_snapshot_pond_id_ponds_id_fk" FOREIGN KEY ("pond_id") REFERENCES "public"."ponds"("id") ON DELETE no action ON UPDATE no action;