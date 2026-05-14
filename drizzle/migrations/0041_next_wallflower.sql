CREATE TABLE "reconciliation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"period_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reconciliation_notes_resolved_consistency" CHECK (("reconciliation_notes"."status" = 'resolved' AND "reconciliation_notes"."resolved_at" IS NOT NULL)
        OR ("reconciliation_notes"."status" != 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "qris_settlement" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "cash_sales_reported" bigint;--> statement-breakpoint
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_notes" ADD CONSTRAINT "reconciliation_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_reconciliation_notes_scope" ON "reconciliation_notes" USING btree ("outlet_id","channel","period_date");--> statement-breakpoint
CREATE INDEX "idx_reconciliation_notes_outlet_date" ON "reconciliation_notes" USING btree ("outlet_id","period_date");