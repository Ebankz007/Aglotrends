CREATE TYPE "public"."kyc_status" AS ENUM('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."platform_fee_status" AS ENUM('PENDING', 'SETTLED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyc_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "kyc_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"legal_name" text,
	"date_of_birth" date,
	"country" text,
	"address" text,
	"id_type" text,
	"id_number" text,
	"documents" jsonb,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid,
	"purpose" "payment_purpose" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"wallet_address" text DEFAULT '' NOT NULL,
	"network" text DEFAULT '' NOT NULL,
	"asset" text DEFAULT '' NOT NULL,
	"status" "platform_fee_status" DEFAULT 'PENDING' NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "platform_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kyc_profiles_user_idx" ON "kyc_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_fees_status_idx" ON "platform_fees" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_fees_user_idx" ON "platform_fees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_fees_payment_idx" ON "platform_fees" USING btree ("payment_id");