ALTER TABLE "ingredient_units" ADD COLUMN "qty_per_ref" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "ingredient_units" ADD COLUMN "ref_unit_label" text;