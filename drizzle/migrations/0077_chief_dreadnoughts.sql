ALTER TABLE "purchases" ADD COLUMN "receipt_status" text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "received_at" timestamp with time zone;