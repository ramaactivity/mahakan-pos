ALTER TABLE "purchase_request_items" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;