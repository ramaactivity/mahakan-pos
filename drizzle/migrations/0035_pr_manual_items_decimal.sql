ALTER TABLE "purchase_request_items" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "requested_qty_decimal" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "received_qty_decimal" numeric(15, 4);