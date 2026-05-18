CREATE TABLE "shift_rebalances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"source" text DEFAULT 'close_shift' NOT NULL,
	"original_actual_cash" bigint NOT NULL,
	"original_variance" bigint NOT NULL,
	"original_qris_settlement" bigint,
	"original_edc_settlement" bigint,
	"corrected_actual_cash" bigint NOT NULL,
	"corrected_qris_settlement" bigint,
	"corrected_edc_settlement" bigint,
	"corrected_variance" bigint,
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
	CONSTRAINT "ck_shift_rebalances_corrected_cash_nonneg" CHECK ("shift_rebalances"."corrected_actual_cash" >= 0),
	CONSTRAINT "ck_shift_rebalances_reason_nonempty" CHECK (length(trim("shift_rebalances"."reason")) >= 3)
);
--> statement-breakpoint
ALTER TABLE "approval_codes" ALTER COLUMN "target_transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD COLUMN "target_shift_rebalance_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_rebalances" ADD CONSTRAINT "shift_rebalances_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_rebalances" ADD CONSTRAINT "shift_rebalances_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_rebalances" ADD CONSTRAINT "shift_rebalances_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_rebalances" ADD CONSTRAINT "shift_rebalances_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_rebalances" ADD CONSTRAINT "shift_rebalances_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_shift_rebalances_pending_per_shift" ON "shift_rebalances" USING btree ("shift_id") WHERE "shift_rebalances"."status" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "idx_shift_rebalances_outlet_status" ON "shift_rebalances" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_shift_rebalances_shift" ON "shift_rebalances" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_shift_rebalances_requested_at" ON "shift_rebalances" USING btree ("requested_at");--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "ck_approval_codes_target_xor" CHECK (("approval_codes"."action_type" = 'shift.rebalance' AND "approval_codes"."target_shift_rebalance_id" IS NOT NULL AND "approval_codes"."target_transaction_id" IS NULL)
       OR ("approval_codes"."action_type" != 'shift.rebalance' AND "approval_codes"."target_transaction_id" IS NOT NULL AND "approval_codes"."target_shift_rebalance_id" IS NULL));