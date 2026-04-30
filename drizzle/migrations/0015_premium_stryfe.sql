CREATE TABLE "employee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"schedule_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"day_off" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_schedules_times_consistency" CHECK (("employee_schedules"."day_off" = true AND "employee_schedules"."start_time" IS NULL AND "employee_schedules"."end_time" IS NULL)
        OR ("employee_schedules"."day_off" = false AND "employee_schedules"."start_time" IS NOT NULL AND "employee_schedules"."end_time" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"base_salary" bigint DEFAULT 0 NOT NULL,
	"work_days" integer DEFAULT 0 NOT NULL,
	"total_work_minutes" integer DEFAULT 0 NOT NULL,
	"total_late_minutes" integer DEFAULT 0 NOT NULL,
	"total_overtime_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_pay" bigint DEFAULT 0 NOT NULL,
	"late_deduction" bigint DEFAULT 0 NOT NULL,
	"bonus" bigint DEFAULT 0 NOT NULL,
	"other_deductions" bigint DEFAULT 0 NOT NULL,
	"gross_pay" bigint DEFAULT 0 NOT NULL,
	"net_pay" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payroll_lines_money_nonneg" CHECK ("payroll_lines"."base_salary" >= 0
        AND "payroll_lines"."overtime_pay" >= 0
        AND "payroll_lines"."late_deduction" >= 0
        AND "payroll_lines"."bonus" >= 0
        AND "payroll_lines"."other_deductions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"finalized_by" uuid,
	"paid_by" uuid,
	CONSTRAINT "ck_payroll_period_range" CHECK ("payroll_periods"."period_end" >= "payroll_periods"."period_start")
);
--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_schedules_employee_date" ON "employee_schedules" USING btree ("employee_id","schedule_date");--> statement-breakpoint
CREATE INDEX "idx_schedules_outlet_date" ON "employee_schedules" USING btree ("outlet_id","schedule_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payroll_lines_period_employee" ON "payroll_lines" USING btree ("period_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_lines_employee" ON "payroll_lines" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_payroll_periods_outlet" ON "payroll_periods" USING btree ("outlet_id","period_start");