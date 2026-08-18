-- Sesi AE-210 — REKENING SUMBER PEMBAYARAN GAJI.
--
-- Sebelum ini metode bayar payroll hanya hidup sebagai argumen fungsi
-- markPayrollPaid (default "transfer") dan jurnalnya SELALU mengkredit 1110
-- Bank BCA. Gaji yang benar-benar ditransfer dari BRI tetap tercatat keluar
-- dari BCA → saldo BCA di Neraca minus, saldo BRI ketinggian, tanpa satu
-- error pun yang muncul.
--
-- Dua kolom ini membuat pilihan owner TERSIMPAN, jadi jurnal bisa diposting
-- ulang ke akun yang benar lewat updatePayrollPaymentMethod.
--
-- Additive semua: kolom nullable + FK + CHECK yang sengaja meloloskan baris
-- lama (kedua kolom NULL). Periode payroll yang sudah ada tidak tersentuh.

ALTER TABLE "payroll_periods" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "ck_payroll_periods_payment_shape" CHECK ("payroll_periods"."payment_method" IS NULL
        OR ("payroll_periods"."payment_method" = 'cash' AND "payroll_periods"."bank_account_id" IS NULL)
        OR ("payroll_periods"."payment_method" <> 'cash' AND "payroll_periods"."bank_account_id" IS NOT NULL));