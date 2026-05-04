-- Phase 2.6 (sesi AB) — additive COA seed for new EDC card variants.
--
-- payment_method column on transactions/split_payments/purchases is `text`
-- without a DB-level enum constraint, so extending allowed values is a
-- code-only change. This migration only adds 4 new chart_of_accounts rows
-- per outlet so the auto-journal hook (sesi T) has accounts to route to
-- when Owner enables auto-journal.
--
-- Idempotent via ON CONFLICT on the partial unique index ux_coa_outlet_code
-- (outlet_id, code) WHERE deleted_at IS NULL.

INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_system, display_order, notes
)
SELECT o.id, '1125', 'Piutang EDC BNI', 'asset', 'debit', '1100',
       true, 15, 'POS card_bni sale → settle T+1'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint
INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_system, display_order, notes
)
SELECT o.id, '1126', 'Piutang EDC Mandiri', 'asset', 'debit', '1100',
       true, 16, 'POS card_mandiri sale → settle T+1'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint
INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_system, display_order, notes
)
SELECT o.id, '1127', 'Piutang EDC BRI', 'asset', 'debit', '1100',
       true, 17, 'POS card_bri sale → settle T+1'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint
INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_system, display_order, notes
)
SELECT o.id, '1128', 'Piutang EDC Lainnya', 'asset', 'debit', '1100',
       true, 18, 'POS card_other sale → settle T+1 (catch-all untuk bank lain: HSBC, OCBC, dll)'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
