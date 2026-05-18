CREATE TABLE "payroll_payslip_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"trigger" text NOT NULL,
	"message_id" text,
	"status" text NOT NULL,
	"error_message" text,
	"error_code" text,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_payslip_emails" ADD CONSTRAINT "payroll_payslip_emails_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslip_emails" ADD CONSTRAINT "payroll_payslip_emails_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslip_emails" ADD CONSTRAINT "payroll_payslip_emails_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslip_emails" ADD CONSTRAINT "payroll_payslip_emails_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payslip_emails_period" ON "payroll_payslip_emails" USING btree ("period_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_payslip_emails_employee" ON "payroll_payslip_emails" USING btree ("employee_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_payslip_emails_line" ON "payroll_payslip_emails" USING btree ("line_id");