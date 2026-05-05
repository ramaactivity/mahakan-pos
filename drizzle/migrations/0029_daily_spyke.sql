-- Phase 6.5 + 6.6 (sesi AC-3) — purchase_requests + purchase_request_items.
--
-- Cashier saat tutup shift fill list ingredient stok ≤ reorder_threshold,
-- INSERT purchase_request + items. Owner notif via WA link. Admin di
-- "Permintaan Belanja" admin section receive qty per item.
--
-- Bukan replace `purchases` — itu header pembelian aktual (inventory
-- movement + accounting). Request adalah "list belanja" pra-belanja.
--
-- NOTE: stripped attendance ALTERs yang ikut kena di drizzle-kit generate
-- karena snapshot 0027/0028 stale (0027 hand-written, snapshot tidak
-- reflect attendance cols). Cols itu sudah ada di prod via 0027 IF NOT
-- EXISTS. Snapshot 0029 onward sudah benar.

CREATE TABLE "purchase_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"ingredient_name_snapshot" text NOT NULL,
	"unit_snapshot" text NOT NULL,
	"requested_qty" bigint NOT NULL,
	"received_qty" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_pri_requested_qty_pos" CHECK ("purchase_request_items"."requested_qty" > 0),
	CONSTRAINT "ck_pri_received_qty_nonneg" CHECK ("purchase_request_items"."received_qty" >= 0),
	CONSTRAINT "ck_pri_received_lte_requested" CHECK ("purchase_request_items"."received_qty" <= "purchase_request_items"."requested_qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"whatsapp_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pri_request" ON "purchase_request_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_pri_ingredient" ON "purchase_request_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_purchase_requests_outlet_status" ON "purchase_requests" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_purchase_requests_shift" ON "purchase_requests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_purchase_requests_outlet_created" ON "purchase_requests" USING btree ("outlet_id","created_at");
