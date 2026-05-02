ALTER TABLE "expense_categories" ADD COLUMN "default_account_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "account_id" uuid;