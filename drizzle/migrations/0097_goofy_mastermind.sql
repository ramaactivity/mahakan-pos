CREATE TABLE "fixed_asset_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"effective_date" date NOT NULL,
	"basis_month" date NOT NULL,
	"carrying_before" bigint NOT NULL,
	"carrying_after" bigint NOT NULL,
	"surplus_credit" bigint DEFAULT 0 NOT NULL,
	"surplus_debit" bigint DEFAULT 0 NOT NULL,
	"pl_gain" bigint DEFAULT 0 NOT NULL,
	"pl_loss" bigint DEFAULT 0 NOT NULL,
	"accum_dep_eliminated" bigint DEFAULT 0 NOT NULL,
	"accum_impairment_delta" bigint DEFAULT 0 NOT NULL,
	"remaining_life_months" integer NOT NULL,
	"reason" text NOT NULL,
	"valuation_basis" text,
	"journal_entry_id" uuid,
	"previous_state" jsonb NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_fav_remaining_life_pos" CHECK ("fixed_asset_valuations"."remaining_life_months" > 0 AND "fixed_asset_valuations"."remaining_life_months" <= 600),
	CONSTRAINT "ck_fav_carrying_nonneg" CHECK ("fixed_asset_valuations"."carrying_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "gross_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "basis_amount" bigint;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "basis_month" date;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "basis_accumulated" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "basis_remaining_months" integer;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "accumulated_impairment" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "revaluation_surplus" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "revaluation_loss_recognized" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_asset_valuations" ADD CONSTRAINT "fixed_asset_valuations_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_valuations" ADD CONSTRAINT "fixed_asset_valuations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_valuations" ADD CONSTRAINT "fixed_asset_valuations_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_valuations" ADD CONSTRAINT "fixed_asset_valuations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fav_asset" ON "fixed_asset_valuations" USING btree ("asset_id","effective_date");--> statement-breakpoint
CREATE INDEX "idx_fav_outlet_date" ON "fixed_asset_valuations" USING btree ("outlet_id","effective_date");--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "ck_fixed_assets_basis_shape" CHECK (("fixed_assets"."basis_amount" IS NULL AND "fixed_assets"."basis_month" IS NULL AND "fixed_assets"."basis_remaining_months" IS NULL)
          OR ("fixed_assets"."basis_amount" IS NOT NULL AND "fixed_assets"."basis_month" IS NOT NULL
              AND "fixed_assets"."basis_remaining_months" IS NOT NULL AND "fixed_assets"."basis_remaining_months" > 0));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "ck_fixed_assets_valuation_nonneg" CHECK ("fixed_assets"."accumulated_impairment" >= 0 AND "fixed_assets"."revaluation_surplus" >= 0
          AND "fixed_assets"."revaluation_loss_recognized" >= 0 AND "fixed_assets"."basis_accumulated" >= 0);--> statement-breakpoint
-- Sesi AE-214 — Revaluasi & Penurunan Nilai (impairment) aset tetap.
--
-- 1) Nilai bruto aset yang sudah ada = harga perolehannya. Selama aset belum
--    pernah dinilai ulang keduanya memang sama; yang membedakan baru muncul
--    setelah revaluasi menulis ulang nilai brutonya (metode eliminasi).
UPDATE fixed_assets SET gross_amount = cost WHERE gross_amount = 0;--> statement-breakpoint
-- 2) Lima akun baru per outlet, di-seed NON-AKTIF (pola sama dengan akun aset
--    tetap sesi W): outlet yang tidak memakai modul ini tidak kebagian akun
--    tambahan di Bagan Akun. Diaktifkan otomatis saat penilaian pertama
--    diposting (VALUATION_ACCOUNT_CODES di fixed-asset-valuation-actions.ts).
--
--    Idempotent via partial unique index ux_coa_outlet_code (outlet_id, code)
--    WHERE deleted_at IS NULL — pola sama dengan migrasi 0095.
INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_contra, is_system, is_active, display_order, notes
)
SELECT o.id, v.code, v.name, v.type, v.normal_balance, v.parent_code,
       v.is_contra, false, false, v.display_order, v.notes
FROM outlets o
CROSS JOIN (VALUES
  ('1291', 'Akumulasi Penurunan Nilai Aset', 'asset', 'credit', '1200', true, 61,
   'Sesi AE-214: kontra-asset PSAK 48. Cr saat penurunan nilai diakui, Dr saat dipulihkan atau saat asetnya direvaluasi (metode eliminasi).'),
  ('3501', 'Surplus Revaluasi Aset Tetap', 'equity', 'credit', '3500', false, 35,
   'Sesi AE-214 (PSAK 16 par. 39-40): Cr saat nilai wajar aset naik; Dr saat aset yang sama turun nilainya kembali (sampai habis) sebelum sisanya jadi rugi.'),
  ('4204', 'Pemulihan Rugi Penurunan Nilai Aset', 'revenue', 'credit', '4200', false, 23,
   'Sesi AE-214 (PSAK 48 par. 117): Cr saat penurunan nilai yang dulu diakui dipulihkan, dan saat kenaikan revaluasi memulihkan rugi revaluasi yang pernah dibebankan.'),
  ('6505', 'Rugi Penurunan Nilai Aset Tetap', 'expense', 'debit', '6500', false, 44,
   'Sesi AE-214 (PSAK 48): Dr saat nilai terpulihkan aset < nilai tercatat. Lawannya 1291.'),
  ('6506', 'Rugi Revaluasi Aset Tetap', 'expense', 'debit', '6500', false, 45,
   'Sesi AE-214 (PSAK 16 par. 40): Dr sisa penurunan revaluasi setelah surplus revaluasi aset yang sama habis terpakai.')
) AS v(code, name, type, normal_balance, parent_code, is_contra, display_order, notes)
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
