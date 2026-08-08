ALTER TABLE "approval_codes" DROP CONSTRAINT "ck_approval_codes_target_xor";--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "ck_approval_codes_target_xor" CHECK (("approval_codes"."action_type" IN ('pos.transaction.void','pos.transaction.refund')
            AND "approval_codes"."target_transaction_id" IS NOT NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL
            AND "approval_codes"."target_entry_change_id" IS NULL)
       OR ("approval_codes"."action_type" = 'shift.rebalance'
            AND "approval_codes"."target_shift_rebalance_id" IS NOT NULL
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL
            AND "approval_codes"."target_entry_change_id" IS NULL)
       OR ("approval_codes"."action_type" = 'pos.transaction.correction'
            AND "approval_codes"."target_transaction_correction_id" IS NOT NULL
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL
            AND "approval_codes"."target_entry_change_id" IS NULL)
       OR ("approval_codes"."action_type" = 'entry_change'
            AND "approval_codes"."target_entry_change_id" IS NOT NULL
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL)
       /* Sesi AE-195 — compliment: SEMUA target NULL. Transaksinya belum
        * ada saat kode diminta, jadi tidak ada baris yang bisa ditunjuk. */
       OR ("approval_codes"."action_type" = 'pos.compliment'
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL
            AND "approval_codes"."target_entry_change_id" IS NULL));