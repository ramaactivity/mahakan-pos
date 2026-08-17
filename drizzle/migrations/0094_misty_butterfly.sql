CREATE TABLE "employee_advance_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"advance_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"bank_account_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"receipt_image_url" text,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_emp_advance_repay_amount_pos" CHECK ("employee_advance_repayments"."amount" > 0),
	CONSTRAINT "ck_emp_advance_repay_method_shape" CHECK (("employee_advance_repayments"."method" = 'cash' AND "employee_advance_repayments"."bank_account_id" IS NULL)
        OR ("employee_advance_repayments"."method" = 'transfer' AND "employee_advance_repayments"."bank_account_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "employee_advances" ADD COLUMN "repaid_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_debt_repayments" ADD COLUMN "receipt_image_url" text;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_advance_id_employee_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."employee_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advance_repayments" ADD CONSTRAINT "employee_advance_repayments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_emp_advance_repay_advance" ON "employee_advance_repayments" USING btree ("advance_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_emp_advance_repay_employee" ON "employee_advance_repayments" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_emp_advance_repay_outlet_date" ON "employee_advance_repayments" USING btree ("outlet_id","occurred_at");--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "ck_employee_advances_repaid_range" CHECK ("employee_advances"."repaid_amount" >= 0 AND "employee_advances"."repaid_amount" <= "employee_advances"."amount");