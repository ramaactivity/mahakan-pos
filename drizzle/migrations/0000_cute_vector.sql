CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"logo_url" text,
	"operational_hours" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"password_hash" text,
	"pin_hash" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_users_auth" CHECK ("users"."password_hash" IS NOT NULL OR "users"."pin_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ux_categories_outlet_name" UNIQUE("outlet_id","name")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_type" text NOT NULL,
	"price_fixed" bigint,
	"price_hot" bigint,
	"price_iced" bigint,
	"is_signature" boolean DEFAULT false NOT NULL,
	"is_sold_out" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"cost_price" bigint,
	"recipe_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ux_menu_items_category_name" UNIQUE("category_id","name"),
	CONSTRAINT "ck_menu_items_price_consistency" CHECK (("menu_items"."price_type" = 'fixed' AND "menu_items"."price_fixed" IS NOT NULL AND "menu_items"."price_hot" IS NULL AND "menu_items"."price_iced" IS NULL)
        OR ("menu_items"."price_type" = 'variant' AND "menu_items"."price_fixed" IS NULL AND ("menu_items"."price_hot" IS NOT NULL OR "menu_items"."price_iced" IS NOT NULL))
        OR ("menu_items"."price_type" = 'open' AND "menu_items"."price_fixed" IS NULL AND "menu_items"."price_hot" IS NULL AND "menu_items"."price_iced" IS NULL)),
	CONSTRAINT "ck_menu_items_price_nonneg" CHECK (("menu_items"."price_fixed" IS NULL OR "menu_items"."price_fixed" >= 0)
        AND ("menu_items"."price_hot" IS NULL OR "menu_items"."price_hot" >= 0)
        AND ("menu_items"."price_iced" IS NULL OR "menu_items"."price_iced" >= 0)
        AND ("menu_items"."cost_price" IS NULL OR "menu_items"."cost_price" >= 0))
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options_json" jsonb,
	"price" bigint DEFAULT 0 NOT NULL,
	"applies_to_categories" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_cash" bigint NOT NULL,
	"actual_cash" bigint,
	"variance" bigint,
	"notes" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_shifts_opening_nonneg" CHECK ("shifts"."opening_cash" >= 0),
	CONSTRAINT "ck_shifts_actual_nonneg" CHECK ("shifts"."actual_cash" IS NULL OR "shifts"."actual_cash" >= 0),
	CONSTRAINT "ck_shifts_close_consistency" CHECK (("shifts"."status" = 'closed' AND "shifts"."closed_at" IS NOT NULL)
        OR ("shifts"."status" = 'open' AND "shifts"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "transaction_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_item_id" uuid NOT NULL,
	"modifier_slug" text NOT NULL,
	"selected_value" text,
	"price_delta" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"item_category_name" text NOT NULL,
	"variant" text,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"modifiers_price_delta" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint NOT NULL,
	"note" text,
	"open_price_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transaction_items_qty_pos" CHECK ("transaction_items"."quantity" > 0),
	CONSTRAINT "ck_transaction_items_money_nonneg" CHECK ("transaction_items"."unit_price" >= 0 AND "transaction_items"."modifiers_price_delta" >= 0 AND "transaction_items"."subtotal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"client_ref_id" uuid,
	"transaction_number" text NOT NULL,
	"pager_number" integer NOT NULL,
	"order_type" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_type" text,
	"discount_value" bigint,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"total" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"cash_received" bigint,
	"cash_change" bigint,
	"status" text DEFAULT 'paid' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_approver" uuid,
	"void_reason" text,
	"refunded_at" timestamp with time zone,
	"refunded_by" uuid,
	"refunded_approver" uuid,
	"refund_reason" text,
	"discount_approver" uuid,
	"served_at" timestamp with time zone,
	"customer_id" uuid,
	"loyalty_points_earned" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_client_ref_id_unique" UNIQUE("client_ref_id"),
	CONSTRAINT "transactions_transaction_number_unique" UNIQUE("transaction_number"),
	CONSTRAINT "ck_transactions_pager_range" CHECK ("transactions"."pager_number" BETWEEN 1 AND 99),
	CONSTRAINT "ck_transactions_money_nonneg" CHECK ("transactions"."subtotal" >= 0 AND "transactions"."discount_amount" >= 0 AND "transactions"."total" >= 0),
	CONSTRAINT "ck_transactions_total_consistency" CHECK ("transactions"."total" = "transactions"."subtotal" - "transactions"."discount_amount"),
	CONSTRAINT "ck_transactions_cash_fields" CHECK (("transactions"."payment_method" = 'cash' AND "transactions"."cash_received" IS NOT NULL)
        OR ("transactions"."payment_method" <> 'cash' AND "transactions"."cash_received" IS NULL AND "transactions"."cash_change" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ux_expense_categories_outlet_name" UNIQUE("outlet_id","name")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"receipt_image_url" text,
	"refunded_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_by" uuid,
	CONSTRAINT "ck_expenses_amount_pos" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"income_date" date NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_incomes_amount_pos" CHECK ("incomes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"user_id" uuid,
	"approver_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item_modifiers" ADD CONSTRAINT "transaction_item_modifiers_transaction_item_id_transaction_items_id_fk" FOREIGN KEY ("transaction_item_id") REFERENCES "public"."transaction_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_approver_users_id_fk" FOREIGN KEY ("voided_approver") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refunded_approver_users_id_fk" FOREIGN KEY ("refunded_approver") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_discount_approver_users_id_fk" FOREIGN KEY ("discount_approver") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_refunded_transaction_id_transactions_id_fk" FOREIGN KEY ("refunded_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email_active" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL AND "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_outlet_role" ON "users" USING btree ("outlet_id","role");--> statement-breakpoint
CREATE INDEX "idx_categories_outlet_active" ON "categories" USING btree ("outlet_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_menu_items_category" ON "menu_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_menu_items_outlet_active" ON "menu_items" USING btree ("outlet_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_shifts_user_status" ON "shifts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_shifts_outlet_opened" ON "shifts" USING btree ("outlet_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_shifts_user_active" ON "shifts" USING btree ("user_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_transaction_item_modifiers_item" ON "transaction_item_modifiers" USING btree ("transaction_item_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_items_transaction" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_items_menu_item" ON "transaction_items" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_shift" ON "transactions" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_outlet_date" ON "transactions" USING btree ("outlet_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_status" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_transactions_payment_method" ON "transactions" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "idx_expenses_outlet_date" ON "expenses" USING btree ("outlet_id","expense_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_incomes_outlet_date" ON "incomes" USING btree ("outlet_id","income_date");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_event_type" ON "audit_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");