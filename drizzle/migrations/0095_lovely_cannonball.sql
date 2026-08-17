ALTER TABLE "employee_advances" ADD COLUMN "funding_source" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "ck_employee_advances_funding_shape" CHECK (("employee_advances"."funding_source" = 'bank' AND "employee_advances"."bank_account_id" IS NOT NULL)
        OR ("employee_advances"."funding_source" <> 'bank' AND "employee_advances"."bank_account_id" IS NULL));--> statement-breakpoint
-- Sesi AE-209b — Kasbon Karyawan masuk pembukuan sebagai PIUTANG.
--
-- Akun baru 1155: auto-debit saat kasbon diberikan, auto-credit saat dicicil /
-- dipotong gaji / di-forgive. Saldonya = kasbon yang belum lunas, jadi Neraca
-- akhirnya menunjukkan uang perusahaan yang sedang dipegang karyawan.
--
-- Idempotent via partial unique index ux_coa_outlet_code (outlet_id, code)
-- WHERE deleted_at IS NULL — pola sama dengan migrasi 0026 & 0028.
INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_contra, is_system, display_order, notes
)
SELECT o.id, '1155', 'Piutang Kasbon Karyawan', 'asset', 'debit', '1100',
       false, true, 41,
       'Sesi AE-209b. Dr saat kasbon diberikan (Cr kas/bank); Cr saat dicicil, dipotong gaji, atau di-forgive. Saldo = kasbon karyawan yang belum lunas.'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;--> statement-breakpoint
-- Kasbon yang sudah ada SEBELUM fitur ini uangnya keluar tanpa pernah
-- dijurnal, jadi tidak boleh dianggap 'cash' (default kolom) — nanti jalur
-- pelunasannya meng-kredit 1155 tanpa debit pasangannya dan saldo piutang
-- jadi MINUS tanpa error apa pun. Tandai 'opening_balance' = di luar
-- pembukuan, potongan gajinya tetap lewat 6105 seperti perilaku lama.
UPDATE employee_advances
   SET funding_source = 'opening_balance'
 WHERE journal_entry_id IS NULL;