ALTER TABLE "public"."payments" ADD COLUMN IF NOT EXISTS "network" text NOT NULL DEFAULT 'trc20';
CREATE INDEX IF NOT EXISTS "payments_network_idx" ON "public"."payments" ("network");
