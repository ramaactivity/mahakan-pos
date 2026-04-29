ALTER TABLE "transactions" DROP CONSTRAINT "ck_transactions_pager_range";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "pager_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "ck_transactions_pager_range" CHECK ("transactions"."pager_number" IS NULL OR "transactions"."pager_number" BETWEEN 1 AND 99);