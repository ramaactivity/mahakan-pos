ALTER TABLE "creditors" ADD COLUMN "linked_investor_id" uuid;--> statement-breakpoint
ALTER TABLE "creditors" ADD COLUMN "converted_from_investor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creditors" ADD CONSTRAINT "creditors_linked_investor_id_investors_id_fk" FOREIGN KEY ("linked_investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creditors_linked_investor" ON "creditors" USING btree ("linked_investor_id");