ALTER TABLE "transactions" ADD COLUMN "opened_crew_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "paid_crew_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD COLUMN "requested_by_crew_id" uuid;--> statement-breakpoint
ALTER TABLE "split_payments" ADD COLUMN "crew_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_opened_crew_id_employees_id_fk" FOREIGN KEY ("opened_crew_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paid_crew_id_employees_id_fk" FOREIGN KEY ("paid_crew_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_requested_by_crew_id_employees_id_fk" FOREIGN KEY ("requested_by_crew_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payments" ADD CONSTRAINT "split_payments_crew_id_employees_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;