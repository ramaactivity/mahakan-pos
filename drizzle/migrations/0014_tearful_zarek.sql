CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"clock_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_out_at" timestamp with time zone,
	"is_late" text DEFAULT 'unknown' NOT NULL,
	"late_minutes" integer,
	"overtime_minutes" integer,
	"work_minutes" integer,
	"notes" text,
	"clocked_in_by" uuid NOT NULL,
	"clocked_out_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_attendance_clock_order" CHECK ("attendance_records"."clock_out_at" IS NULL OR "attendance_records"."clock_out_at" >= "attendance_records"."clock_in_at"),
	CONSTRAINT "ck_attendance_minutes_nonneg" CHECK (("attendance_records"."late_minutes" IS NULL OR "attendance_records"."late_minutes" >= 0)
        AND ("attendance_records"."overtime_minutes" IS NULL OR "attendance_records"."overtime_minutes" >= 0)
        AND ("attendance_records"."work_minutes" IS NULL OR "attendance_records"."work_minutes" >= 0))
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clocked_in_by_users_id_fk" FOREIGN KEY ("clocked_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clocked_out_by_users_id_fk" FOREIGN KEY ("clocked_out_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attendance_outlet_date" ON "attendance_records" USING btree ("outlet_id","shift_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_employee_date" ON "attendance_records" USING btree ("employee_id","shift_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_attendance_open_per_employee_date" ON "attendance_records" USING btree ("employee_id","shift_date") WHERE "attendance_records"."clock_out_at" IS NULL;