CREATE TABLE "pending_entry_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"operation" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"original_data" jsonb NOT NULL,
	"proposed_data" jsonb,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approval_code_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_reason" text,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_pec_reason_nonempty" CHECK (length(trim("pending_entry_changes"."reason")) >= 3),
	CONSTRAINT "ck_pec_proposed_data_for_update" CHECK (("pending_entry_changes"."operation" = 'delete') OR ("pending_entry_changes"."operation" = 'update' AND "pending_entry_changes"."proposed_data" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "approval_codes" DROP CONSTRAINT "ck_approval_codes_target_xor";--> statement-breakpoint
ALTER TABLE "approval_codes" ADD COLUMN "target_entry_change_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_entry_changes" ADD CONSTRAINT "pending_entry_changes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entry_changes" ADD CONSTRAINT "pending_entry_changes_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entry_changes" ADD CONSTRAINT "pending_entry_changes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entry_changes" ADD CONSTRAINT "pending_entry_changes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entry_changes" ADD CONSTRAINT "pending_entry_changes_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_pec_active_per_entity" ON "pending_entry_changes" USING btree ("entity_type","entity_id") WHERE "pending_entry_changes"."status" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "idx_pec_outlet_status" ON "pending_entry_changes" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_pec_requested_by" ON "pending_entry_changes" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "idx_pec_requested_at" ON "pending_entry_changes" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "idx_approval_codes_entry_change_lookup" ON "approval_codes" USING btree ("target_entry_change_id","action_type","consumed_at");--> statement-breakpoint
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
            AND "approval_codes"."target_transaction_correction_id" IS NULL));