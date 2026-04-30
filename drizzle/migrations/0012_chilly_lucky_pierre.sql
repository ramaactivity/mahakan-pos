CREATE TABLE "split_payment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_payment_id" uuid NOT NULL,
	"transaction_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_split_payment_items_qty_pos" CHECK ("split_payment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "split_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"cash_received" bigint,
	"cash_change" bigint,
	"split_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_split_payments_amount_pos" CHECK ("split_payments"."amount" > 0),
	CONSTRAINT "ck_split_payments_cash_fields" CHECK (("split_payments"."payment_method" = 'cash' AND "split_payments"."cash_received" IS NOT NULL)
        OR ("split_payments"."payment_method" <> 'cash' AND "split_payments"."cash_received" IS NULL AND "split_payments"."cash_change" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "ck_transactions_cash_fields";--> statement-breakpoint
ALTER TABLE "split_payment_items" ADD CONSTRAINT "split_payment_items_split_payment_id_split_payments_id_fk" FOREIGN KEY ("split_payment_id") REFERENCES "public"."split_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payment_items" ADD CONSTRAINT "split_payment_items_transaction_item_id_transaction_items_id_fk" FOREIGN KEY ("transaction_item_id") REFERENCES "public"."transaction_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payments" ADD CONSTRAINT "split_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payments" ADD CONSTRAINT "split_payments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payments" ADD CONSTRAINT "split_payments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_payments" ADD CONSTRAINT "split_payments_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_split_payment_items_split" ON "split_payment_items" USING btree ("split_payment_id");--> statement-breakpoint
CREATE INDEX "idx_split_payment_items_trx_item" ON "split_payment_items" USING btree ("transaction_item_id");--> statement-breakpoint
CREATE INDEX "idx_split_payments_transaction" ON "split_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_split_payments_shift" ON "split_payments" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_split_payments_outlet_created" ON "split_payments" USING btree ("outlet_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "ck_transactions_cash_fields" CHECK (("transactions"."payment_method" = 'cash' AND "transactions"."cash_received" IS NOT NULL)
        OR ("transactions"."payment_method" = 'split' AND "transactions"."cash_received" IS NULL AND "transactions"."cash_change" IS NULL)
        OR ("transactions"."payment_method" NOT IN ('cash', 'split') AND "transactions"."cash_received" IS NULL AND "transactions"."cash_change" IS NULL));