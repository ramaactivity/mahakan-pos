CREATE TABLE "transaction_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id_at_request" uuid NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"source" text DEFAULT 'kasir_active_shift' NOT NULL,
	"original_payment_method" text NOT NULL,
	"original_total" bigint NOT NULL,
	"original_subtotal" bigint NOT NULL,
	"original_discount_amount" bigint NOT NULL,
	"original_split_breakdown" jsonb,
	"original_loyalty_points_earned" integer,
	"original_loyalty_points_redeemed" integer,
	"corrected_payment_method" text NOT NULL,
	"corrected_total" bigint NOT NULL,
	"corrected_discount_amount" bigint NOT NULL,
	"corrected_split_breakdown" jsonb,
	"reason" text NOT NULL,
	"photo_url" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approval_code_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_reason" text,
	"cancelled_at" timestamp with time zone,
	"original_journal_entry_id" uuid,
	"reverse_journal_entry_id" uuid,
	"corrected_journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transaction_corrections_corrected_total_pos" CHECK ("transaction_corrections"."corrected_total" > 0),
	CONSTRAINT "ck_transaction_corrections_corrected_discount_nonneg" CHECK ("transaction_corrections"."corrected_discount_amount" >= 0),
	CONSTRAINT "ck_transaction_corrections_reason_nonempty" CHECK (length(trim("transaction_corrections"."reason")) >= 3),
	CONSTRAINT "ck_transaction_corrections_split_consistency" CHECK (("transaction_corrections"."corrected_payment_method" = 'split' AND "transaction_corrections"."corrected_split_breakdown" IS NOT NULL)
       OR ("transaction_corrections"."corrected_payment_method" != 'split' AND "transaction_corrections"."corrected_split_breakdown" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "approval_codes" DROP CONSTRAINT "ck_approval_codes_target_xor";--> statement-breakpoint
ALTER TABLE "approval_codes" ADD COLUMN "target_transaction_correction_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_shift_id_at_request_shifts_id_fk" FOREIGN KEY ("shift_id_at_request") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_corrections" ADD CONSTRAINT "transaction_corrections_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_transaction_corrections_pending_per_trx" ON "transaction_corrections" USING btree ("transaction_id") WHERE "transaction_corrections"."status" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "idx_transaction_corrections_outlet_status" ON "transaction_corrections" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_transaction_corrections_transaction" ON "transaction_corrections" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_corrections_requested_at" ON "transaction_corrections" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "idx_approval_codes_correction_lookup" ON "approval_codes" USING btree ("target_transaction_correction_id","action_type","consumed_at");--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "ck_approval_codes_target_xor" CHECK (("approval_codes"."action_type" IN ('pos.transaction.void','pos.transaction.refund')
            AND "approval_codes"."target_transaction_id" IS NOT NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL)
       OR ("approval_codes"."action_type" = 'shift.rebalance'
            AND "approval_codes"."target_shift_rebalance_id" IS NOT NULL
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_transaction_correction_id" IS NULL)
       OR ("approval_codes"."action_type" = 'pos.transaction.correction'
            AND "approval_codes"."target_transaction_correction_id" IS NOT NULL
            AND "approval_codes"."target_transaction_id" IS NULL
            AND "approval_codes"."target_shift_rebalance_id" IS NULL));