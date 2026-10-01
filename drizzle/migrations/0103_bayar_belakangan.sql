ALTER TABLE "transactions" ADD COLUMN "deferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_by" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_crew_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_guarantor" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_contact" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_due_date" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deferred_note" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deferred_by_users_id_fk" FOREIGN KEY ("deferred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deferred_crew_id_employees_id_fk" FOREIGN KEY ("deferred_crew_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;