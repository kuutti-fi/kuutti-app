CREATE TABLE "gate" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"pond_id" uuid NOT NULL,
	"admitted_at" timestamp with time zone,
	"place_said" integer,
	"pool_said" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"counted_at" timestamp with time zone,
	CONSTRAINT "gate_place_said_check" CHECK ("gate"."place_said" IS NULL OR "gate"."place_said" >= 1),
	CONSTRAINT "gate_pool_said_check" CHECK ("gate"."pool_said" >= 0),
	CONSTRAINT "gate_admitted_check" CHECK ("gate"."admitted_at" IS NULL OR "gate"."place_said" IS NULL),
	CONSTRAINT "gate_opened_check" CHECK ("gate"."opened_at" IS NULL OR "gate"."admitted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "gate" ADD CONSTRAINT "gate_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate" ADD CONSTRAINT "gate_pond_id_ponds_id_fk" FOREIGN KEY ("pond_id") REFERENCES "public"."ponds"("id") ON DELETE no action ON UPDATE no action;