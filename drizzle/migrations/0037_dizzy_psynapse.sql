CREATE TABLE "supplier_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"unit_cost" bigint NOT NULL,
	"pack_size" numeric(15, 4) NOT NULL,
	"pack_unit" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_si_unit_cost_pos" CHECK ("supplier_ingredients"."unit_cost" > 0),
	CONSTRAINT "ck_si_pack_size_pos" CHECK ("supplier_ingredients"."pack_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ingredients" ADD CONSTRAINT "supplier_ingredients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_ingredients_active" ON "supplier_ingredients" USING btree ("outlet_id","supplier_id","ingredient_id") WHERE "supplier_ingredients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_ingredients_primary" ON "supplier_ingredients" USING btree ("outlet_id","ingredient_id") WHERE "supplier_ingredients"."is_primary" = true AND "supplier_ingredients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_supplier_ingredients_outlet_supplier" ON "supplier_ingredients" USING btree ("outlet_id","supplier_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_ingredients_outlet_ingredient" ON "supplier_ingredients" USING btree ("outlet_id","ingredient_id");