CREATE TABLE "ingredient_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"label" text NOT NULL,
	"qty_per_base" numeric(15, 4) NOT NULL,
	"is_default_buy" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_ingredient_units_qty_pos" CHECK ("ingredient_units"."qty_per_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD COLUMN "ingredient_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_ingredient_units_label_active" ON "ingredient_units" USING btree ("ingredient_id",lower("label")) WHERE "ingredient_units"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_ingredient_units_default_buy" ON "ingredient_units" USING btree ("ingredient_id") WHERE "ingredient_units"."is_default_buy" = true AND "ingredient_units"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ingredient_units_ingredient" ON "ingredient_units" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_ingredient_units_outlet" ON "ingredient_units" USING btree ("outlet_id");--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_ingredient_unit_id_ingredient_units_id_fk" FOREIGN KEY ("ingredient_unit_id") REFERENCES "public"."ingredient_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_ingredients_unit" ON "supplier_ingredients" USING btree ("ingredient_unit_id");