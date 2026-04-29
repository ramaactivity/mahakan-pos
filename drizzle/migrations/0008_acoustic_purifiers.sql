CREATE TABLE "refund_event_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_event_id" uuid NOT NULL,
	"transaction_item_id" uuid NOT NULL,
	"quantity_refunded" integer NOT NULL,
	"amount_refunded" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_refund_event_items_qty_pos" CHECK ("refund_event_items"."quantity_refunded" > 0),
	CONSTRAINT "ck_refund_event_items_amount_nonneg" CHECK ("refund_event_items"."amount_refunded" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"total_refunded" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"approver_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_refund_events_total_pos" CHECK ("refund_events"."total_refunded" > 0)
);
--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "refunded_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "refunded_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "refunded_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_event_items" ADD CONSTRAINT "refund_event_items_refund_event_id_refund_events_id_fk" FOREIGN KEY ("refund_event_id") REFERENCES "public"."refund_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_event_items" ADD CONSTRAINT "refund_event_items_transaction_item_id_transaction_items_id_fk" FOREIGN KEY ("transaction_item_id") REFERENCES "public"."transaction_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refund_event_items_event" ON "refund_event_items" USING btree ("refund_event_id");--> statement-breakpoint
CREATE INDEX "idx_refund_event_items_trx_item" ON "refund_event_items" USING btree ("transaction_item_id");--> statement-breakpoint
CREATE INDEX "idx_refund_events_transaction" ON "refund_events" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_refund_events_outlet_created" ON "refund_events" USING btree ("outlet_id","created_at");--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "ck_transaction_items_refunded_qty_bound" CHECK ("transaction_items"."refunded_quantity" >= 0 AND "transaction_items"."refunded_quantity" <= "transaction_items"."quantity");--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "ck_transaction_items_refunded_amount_nonneg" CHECK ("transaction_items"."refunded_amount" >= 0);