ALTER TABLE "cash_deposits" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD COLUMN "bank_account_id" uuid;