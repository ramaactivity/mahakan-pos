CREATE TABLE "daily_market_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(14, 4) NOT NULL,
	"unit" text,
	"qty_master" numeric(14, 4) NOT NULL,
	"unit_cost" bigint NOT NULL,
	"subtotal" bigint NOT NULL,
	"name_snapshot" text NOT NULL,
	"unit_snapshot" text NOT NULL,
	"section_snapshot" text,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_daily_market_items_qty_pos" CHECK ("daily_market_items"."qty" > 0),
	CONSTRAINT "ck_daily_market_items_qty_master_pos" CHECK ("daily_market_items"."qty_master" > 0),
	CONSTRAINT "ck_daily_market_items_subtotal_pos" CHECK ("daily_market_items"."subtotal" > 0),
	CONSTRAINT "ck_daily_market_items_unit_cost_nonneg" CHECK ("daily_market_items"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_market_items" ADD CONSTRAINT "daily_market_items_entry_id_daily_market_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."daily_market_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_market_items_entry" ON "daily_market_items" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_daily_market_items_ingredient" ON "daily_market_items" USING btree ("ingredient_id");--> statement-breakpoint
ALTER TABLE "daily_market_entries" DROP COLUMN "ingredient_ids";