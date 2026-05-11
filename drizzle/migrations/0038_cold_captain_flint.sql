ALTER TABLE "transaction_items" ADD COLUMN "prep_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "prep_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "prep_done_at" timestamp with time zone;