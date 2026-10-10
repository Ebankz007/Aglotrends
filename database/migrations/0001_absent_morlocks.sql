CREATE TYPE "public"."payment_purpose" AS ENUM('REGISTRATION', 'DEPOSIT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"payment_ref" text NOT NULL,
	"gateway_txid" text,
	"payment_url" text,
	"tx_hash" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_ref_idx" ON "payments" USING btree ("payment_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");