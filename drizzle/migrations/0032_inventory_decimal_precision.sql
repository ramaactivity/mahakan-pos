ALTER TABLE "ingredients" ADD COLUMN "current_stock_decimal" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "qty_delta_decimal" numeric(15, 4);