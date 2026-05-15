CREATE TABLE "employee_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text,
	"issued_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deducted_from_period_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_employee_advances_amount_pos" CHECK ("employee_advances"."amount" > 0),
	CONSTRAINT "ck_employee_advances_resolve_consistency" CHECK (("employee_advances"."status" = 'pending' AND "employee_advances"."resolved_at" IS NULL)
        OR ("employee_advances"."status" != 'pending' AND "employee_advances"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" DROP CONSTRAINT "ck_payroll_lines_money_nonneg";--> statement-breakpoint
ALTER TABLE "employee_career_history" ADD COLUMN "daily_rate" bigint;--> statement-breakpoint
ALTER TABLE "employee_career_history" ADD COLUMN "payment_type" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payment_type" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "daily_rate" bigint;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "thr" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "advance_deduction" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_deducted_from_period_id_payroll_periods_id_fk" FOREIGN KEY ("deducted_from_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_advances_employee" ON "employee_advances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_advances_period" ON "employee_advances" USING btree ("deducted_from_period_id");--> statement-breakpoint
CREATE INDEX "idx_employee_advances_outlet_status" ON "employee_advances" USING btree ("outlet_id","status");--> statement-breakpoint
ALTER TABLE "employee_career_history" ADD CONSTRAINT "ck_employee_career_history_daily_rate_nonneg" CHECK ("employee_career_history"."daily_rate" IS NULL OR "employee_career_history"."daily_rate" >= 0);--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "ck_employees_daily_rate_nonneg" CHECK ("employees"."daily_rate" IS NULL OR "employees"."daily_rate" >= 0);--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "ck_payroll_lines_money_nonneg" CHECK ("payroll_lines"."base_salary" >= 0
        AND "payroll_lines"."overtime_pay" >= 0
        AND "payroll_lines"."late_deduction" >= 0
        AND "payroll_lines"."bonus" >= 0
        AND "payroll_lines"."thr" >= 0
        AND "payroll_lines"."advance_deduction" >= 0
        AND "payroll_lines"."other_deductions" >= 0);