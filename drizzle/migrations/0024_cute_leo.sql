CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"cost" bigint NOT NULL,
	"salvage_value" bigint DEFAULT 0 NOT NULL,
	"useful_life_months" integer NOT NULL,
	"acquired_date" date NOT NULL,
	"asset_account_code" text NOT NULL,
	"depreciation_account_code" text NOT NULL,
	"accumulated_depreciation_account_code" text DEFAULT '1290' NOT NULL,
	"last_depreciated_month" date,
	"deleted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_by" uuid,
	CONSTRAINT "ck_fixed_assets_cost_pos" CHECK ("fixed_assets"."cost" > 0),
	CONSTRAINT "ck_fixed_assets_salvage_lte_cost" CHECK ("fixed_assets"."salvage_value" >= 0 AND "fixed_assets"."salvage_value" < "fixed_assets"."cost"),
	CONSTRAINT "ck_fixed_assets_useful_life_pos" CHECK ("fixed_assets"."useful_life_months" > 0 AND "fixed_assets"."useful_life_months" <= 600)
);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fixed_assets_outlet_active" ON "fixed_assets" USING btree ("outlet_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_fixed_assets_acquired" ON "fixed_assets" USING btree ("outlet_id","acquired_date");