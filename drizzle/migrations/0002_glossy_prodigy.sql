CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"cost_per_unit" bigint DEFAULT 0 NOT NULL,
	"current_stock" bigint DEFAULT 0 NOT NULL,
	"reorder_threshold" bigint,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_ingredients_cost_nonneg" CHECK ("ingredients"."cost_per_unit" >= 0),
	CONSTRAINT "ck_ingredients_threshold_nonneg" CHECK ("ingredients"."reorder_threshold" IS NULL OR "ingredients"."reorder_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty_delta" bigint NOT NULL,
	"unit_cost_at_movement" bigint,
	"reference_type" text,
	"reference_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_inventory_movements_unit_cost_nonneg" CHECK ("inventory_movements"."unit_cost_at_movement" IS NULL OR "inventory_movements"."unit_cost_at_movement" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_recipe_ingredients_recipe_ingredient" UNIQUE("recipe_id","ingredient_id"),
	CONSTRAINT "ck_recipe_ingredients_qty_pos" CHECK ("recipe_ingredients"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"variant" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ux_recipes_menu_variant" UNIQUE NULLS NOT DISTINCT("menu_item_id","variant")
);
--> statement-breakpoint
ALTER TABLE "menu_items" DROP CONSTRAINT "ck_menu_items_price_nonneg";--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "cogs" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "cogs" bigint;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_ingredients_outlet_name_active" ON "ingredients" USING btree ("outlet_id","name") WHERE "ingredients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ingredients_outlet_active" ON "ingredients" USING btree ("outlet_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_inventory_movements_ingredient_date" ON "inventory_movements" USING btree ("ingredient_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_inventory_movements_reference" ON "inventory_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_movements_outlet_date" ON "inventory_movements" USING btree ("outlet_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_recipe_ingredients_recipe" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "idx_recipe_ingredients_ingredient" ON "recipe_ingredients" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_recipes_menu_item" ON "recipes" USING btree ("menu_item_id");--> statement-breakpoint
ALTER TABLE "menu_items" DROP COLUMN "cost_price";--> statement-breakpoint
ALTER TABLE "menu_items" DROP COLUMN "recipe_id";--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "ck_menu_items_price_nonneg" CHECK (("menu_items"."price_fixed" IS NULL OR "menu_items"."price_fixed" >= 0)
        AND ("menu_items"."price_hot" IS NULL OR "menu_items"."price_hot" >= 0)
        AND ("menu_items"."price_iced" IS NULL OR "menu_items"."price_iced" >= 0));--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "ck_transaction_items_cogs_nonneg" CHECK ("transaction_items"."cogs" IS NULL OR "transaction_items"."cogs" >= 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "ck_transactions_cogs_nonneg" CHECK ("transactions"."cogs" IS NULL OR "transactions"."cogs" >= 0);