ALTER TABLE "transactions" ADD COLUMN "stock_deducted_at" timestamp with time zone;--> statement-breakpoint
-- Sesi AE-62x backfill — semua transaksi existing dianggap stock-deducted di
-- created_at (pre-AE-62x behavior: saveAsOpenBill langsung deduct stock).
-- Setelah deploy: new sale path tetap set stock_deducted_at = NOW(); new
-- saveAsOpenBill skip + leave NULL untuk defer mode. closeOpenBill check
-- NULL → deduct sekarang + stamp.
UPDATE "transactions" SET "stock_deducted_at" = "created_at" WHERE "stock_deducted_at" IS NULL;