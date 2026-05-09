ALTER TABLE "purchase_items" ADD COLUMN "qty_decimal" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "unit_override" text;