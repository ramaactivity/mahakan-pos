CREATE TABLE "promo_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"discount_amount" bigint NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid NOT NULL,
	"approver_id" uuid,
	CONSTRAINT "ck_promo_usages_amount_nonneg" CHECK ("promo_usages"."discount_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_value" bigint NOT NULL,
	"max_discount_amount" bigint,
	"scope" text DEFAULT 'whole_bill' NOT NULL,
	"scope_category_ids" uuid[],
	"min_subtotal" bigint,
	"applicable_order_types" text[],
	"applicable_payment_methods" text[],
	"start_date" date,
	"end_date" date,
	"days_of_week" integer[],
	"start_time" time,
	"end_time" time,
	"max_total_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_promos_discount_value_positive" CHECK ("promos"."discount_value" > 0),
	CONSTRAINT "ck_promos_percent_range" CHECK ("promos"."discount_type" <> 'percent' OR ("promos"."discount_value" BETWEEN 1 AND 100)),
	CONSTRAINT "ck_promos_max_discount_nonneg" CHECK ("promos"."max_discount_amount" IS NULL OR "promos"."max_discount_amount" >= 0),
	CONSTRAINT "ck_promos_min_subtotal_nonneg" CHECK ("promos"."min_subtotal" IS NULL OR "promos"."min_subtotal" >= 0),
	CONSTRAINT "ck_promos_uses_consistent" CHECK ("promos"."max_total_uses" IS NULL OR "promos"."current_uses" <= "promos"."max_total_uses"),
	CONSTRAINT "ck_promos_date_range" CHECK ("promos"."start_date" IS NULL OR "promos"."end_date" IS NULL OR "promos"."start_date" <= "promos"."end_date")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "promo_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_promo_usages_promo" ON "promo_usages" USING btree ("promo_id");--> statement-breakpoint
CREATE INDEX "idx_promo_usages_transaction" ON "promo_usages" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_promo_usages_outlet_date" ON "promo_usages" USING btree ("outlet_id","applied_at");--> statement-breakpoint
CREATE INDEX "idx_promos_outlet_status" ON "promos" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_promos_active_window" ON "promos" USING btree ("start_date","end_date");