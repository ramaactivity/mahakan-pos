CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"received_qty" bigint NOT NULL,
	"received_qty_decimal" numeric(15, 4),
	"unit_cost" bigint NOT NULL,
	"total_cost" bigint NOT NULL,
	"movement_id" uuid,
	"ingredient_name_snapshot" text NOT NULL,
	"unit_snapshot" text NOT NULL,
	"section_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_gr_items_received_qty_pos" CHECK ("goods_receipt_items"."received_qty" > 0),
	CONSTRAINT "ck_gr_items_total_nonneg" CHECK ("goods_receipt_items"."total_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"received_date" date NOT NULL,
	"notes" text,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_goods_receipts_total_nonneg" CHECK ("goods_receipts"."total_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "received_qty" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "received_qty_decimal" numeric(15, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gr_items_gr" ON "goods_receipt_items" USING btree ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX "idx_gr_items_purchase_item" ON "goods_receipt_items" USING btree ("purchase_item_id");--> statement-breakpoint
CREATE INDEX "idx_gr_items_ingredient" ON "goods_receipt_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_goods_receipts_purchase" ON "goods_receipts" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_goods_receipts_outlet_date" ON "goods_receipts" USING btree ("outlet_id","received_date");