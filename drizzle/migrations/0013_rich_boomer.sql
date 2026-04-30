CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"file_url" text,
	"expires_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"nik" text,
	"email" text,
	"phone" text,
	"address" text,
	"date_of_birth" date,
	"employee_number" text,
	"position" text,
	"department" text,
	"hire_date" date,
	"employment_type" text,
	"salary_amount" bigint,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"resigned_at" timestamp with time zone,
	"resign_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_employees_salary_nonneg" CHECK ("employees"."salary_amount" IS NULL OR "employees"."salary_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_employee_documents_employee" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_employee_documents_expires" ON "employee_documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_employees_outlet" ON "employees" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "idx_employees_status" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_employees_user_active" ON "employees" USING btree ("user_id") WHERE "employees"."user_id" IS NOT NULL AND "employees"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_employees_employee_number_outlet" ON "employees" USING btree ("outlet_id","employee_number") WHERE "employees"."employee_number" IS NOT NULL AND "employees"."deleted_at" IS NULL;