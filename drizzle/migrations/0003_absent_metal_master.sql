ALTER TABLE "recipes" DROP CONSTRAINT "ux_recipes_menu_variant";--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "menu_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "is_preparation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "preparation_yield" bigint;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "cost_last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "ingredient_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "waste_factor_pct" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_recipes_menu_variant_set" ON "recipes" USING btree ("menu_item_id","variant") WHERE "recipes"."menu_item_id" IS NOT NULL AND "recipes"."variant" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_recipes_menu_no_variant" ON "recipes" USING btree ("menu_item_id") WHERE "recipes"."menu_item_id" IS NOT NULL AND "recipes"."variant" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_recipes_preparation" ON "recipes" USING btree ("ingredient_id") WHERE "recipes"."ingredient_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_recipes_ingredient" ON "recipes" USING btree ("ingredient_id");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ck_ingredients_prep_yield_required" CHECK ("ingredients"."is_preparation" = false OR "ingredients"."preparation_yield" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ck_ingredients_prep_yield_pos" CHECK ("ingredients"."preparation_yield" IS NULL OR "ingredients"."preparation_yield" > 0);--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "ck_recipes_target_xor" CHECK (("recipes"."menu_item_id" IS NOT NULL AND "recipes"."ingredient_id" IS NULL)
        OR ("recipes"."menu_item_id" IS NULL AND "recipes"."ingredient_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "ck_recipes_waste_range" CHECK ("recipes"."waste_factor_pct" >= 0 AND "recipes"."waste_factor_pct" <= 200);