ALTER TABLE "attendance_records" ADD COLUMN "manual_edit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "manual_edit_by" uuid;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "manual_edit_reason" text;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_manual_edit_by_users_id_fk" FOREIGN KEY ("manual_edit_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;