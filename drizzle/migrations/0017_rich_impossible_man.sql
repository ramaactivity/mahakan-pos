CREATE TABLE "employee_career_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"position" text,
	"department" text,
	"employment_type" text,
	"salary_amount" bigint,
	"note" text,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_employee_career_history_salary_nonneg" CHECK ("employee_career_history"."salary_amount" IS NULL OR "employee_career_history"."salary_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "employee_career_history" ADD CONSTRAINT "employee_career_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_career_history" ADD CONSTRAINT "employee_career_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_career_history_employee" ON "employee_career_history" USING btree ("employee_id","effective_date");