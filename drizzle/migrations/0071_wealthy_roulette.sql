ALTER TABLE "ingredients" ADD COLUMN "unit_tracking" text;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "unit_tracking_per_cogs" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "unit_belanja" text;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "unit_belanja_per_cogs" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "skipped_stock_update" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ck_ingredients_unit_tracking_per_cogs_pos" CHECK ("ingredients"."unit_tracking_per_cogs" IS NULL OR "ingredients"."unit_tracking_per_cogs" > 0);--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ck_ingredients_unit_belanja_per_cogs_pos" CHECK ("ingredients"."unit_belanja_per_cogs" IS NULL OR "ingredients"."unit_belanja_per_cogs" > 0);