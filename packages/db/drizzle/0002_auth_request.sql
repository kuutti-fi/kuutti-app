CREATE TABLE "auth_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"platform" text NOT NULL,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_used_at" timestamp with time zone,
	"account_id" uuid,
	"outcome" text,
	CONSTRAINT "auth_request_state_unique" UNIQUE("state"),
	CONSTRAINT "auth_request_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "auth_request" ADD CONSTRAINT "auth_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_request_expires_at_idx" ON "auth_request" USING btree ("expires_at");