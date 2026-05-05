CREATE TABLE "settlement_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"settlement_date" date NOT NULL,
	"channel" text NOT NULL,
	"expected_amount" bigint DEFAULT 0 NOT NULL,
	"actual_amount" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_settlement_logs_amounts_nonneg" CHECK ("settlement_logs"."expected_amount" >= 0 AND "settlement_logs"."actual_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_logs" ADD CONSTRAINT "settlement_logs_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_logs" ADD CONSTRAINT "settlement_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_logs" ADD CONSTRAINT "settlement_logs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_settlement_logs_outlet_date_channel" ON "settlement_logs" USING btree ("outlet_id","settlement_date","channel") WHERE "settlement_logs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_settlement_logs_outlet_date" ON "settlement_logs" USING btree ("outlet_id","settlement_date");