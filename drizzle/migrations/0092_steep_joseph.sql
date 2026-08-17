ALTER TABLE "creditor_repayments" ALTER COLUMN "bank_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD COLUMN "funding_source" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD COLUMN "paid_by_pengelola_id" uuid;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD COLUMN "capital_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD COLUMN "receipt_image_url" text;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_paid_by_pengelola_id_pengelola_id_fk" FOREIGN KEY ("paid_by_pengelola_id") REFERENCES "public"."pengelola"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_capital_movement_id_capital_movements_id_fk" FOREIGN KEY ("capital_movement_id") REFERENCES "public"."capital_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creditor_repay_pengelola" ON "creditor_repayments" USING btree ("paid_by_pengelola_id");--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "ck_creditor_repay_funding_shape" CHECK (
        ("creditor_repayments"."funding_source" = 'company'
          AND "creditor_repayments"."bank_account_id" IS NOT NULL
          AND "creditor_repayments"."paid_by_pengelola_id" IS NULL)
        OR ("creditor_repayments"."funding_source" = 'pengelola'
          AND "creditor_repayments"."paid_by_pengelola_id" IS NOT NULL
          AND "creditor_repayments"."bank_account_id" IS NULL)
      );