CREATE TABLE "settlement_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"recorded_amount" bigint NOT NULL,
	"recorded_account_code" text NOT NULL,
	"actual_amount" bigint NOT NULL,
	"actual_account_code" text NOT NULL,
	"diff_amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_settlement_revisions_recorded_pos" CHECK ("settlement_revisions"."recorded_amount" > 0),
	CONSTRAINT "ck_settlement_revisions_actual_nonneg" CHECK ("settlement_revisions"."actual_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_revisions" ADD CONSTRAINT "settlement_revisions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_revisions" ADD CONSTRAINT "settlement_revisions_settlement_id_aggregator_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."aggregator_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_revisions" ADD CONSTRAINT "settlement_revisions_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_revisions" ADD CONSTRAINT "settlement_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_settlement_revisions_settlement" ON "settlement_revisions" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "idx_settlement_revisions_outlet_date" ON "settlement_revisions" USING btree ("outlet_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_settlement_revisions_one_active" ON "settlement_revisions" USING btree ("settlement_id") WHERE "settlement_revisions"."status" = 'posted';