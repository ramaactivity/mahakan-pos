CREATE TABLE "stock_opname_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"expected_qty" bigint NOT NULL,
	"actual_qty" bigint,
	"unit_cost_at_snapshot" bigint DEFAULT 0 NOT NULL,
	"ingredient_name_snapshot" text NOT NULL,
	"unit_snapshot" text NOT NULL,
	"note" text,
	"counted_at" timestamp with time zone,
	"counted_by" uuid,
	"movement_id" uuid,
	CONSTRAINT "ck_opname_lines_expected_nonneg" CHECK ("stock_opname_lines"."expected_qty" >= 0),
	CONSTRAINT "ck_opname_lines_actual_nonneg" CHECK ("stock_opname_lines"."actual_qty" IS NULL OR "stock_opname_lines"."actual_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_opname_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"period_label" text NOT NULL,
	"notes" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"total_lines" integer DEFAULT 0 NOT NULL,
	"counted_lines" integer DEFAULT 0 NOT NULL,
	"total_diff_qty" bigint DEFAULT 0 NOT NULL,
	"total_diff_cost" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_opname_sessions_counted_le_total" CHECK ("stock_opname_sessions"."counted_lines" <= "stock_opname_sessions"."total_lines")
);
--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_session_id_stock_opname_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stock_opname_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_sessions" ADD CONSTRAINT "stock_opname_sessions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_sessions" ADD CONSTRAINT "stock_opname_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_sessions" ADD CONSTRAINT "stock_opname_sessions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_sessions" ADD CONSTRAINT "stock_opname_sessions_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_sessions" ADD CONSTRAINT "stock_opname_sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_opname_lines_session_ingredient" ON "stock_opname_lines" USING btree ("session_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_opname_lines_session" ON "stock_opname_lines" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_opname_lines_ingredient" ON "stock_opname_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "idx_opname_sessions_outlet_status" ON "stock_opname_sessions" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_opname_sessions_outlet_started" ON "stock_opname_sessions" USING btree ("outlet_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_opname_sessions_active_per_outlet" ON "stock_opname_sessions" USING btree ("outlet_id") WHERE "stock_opname_sessions"."status" IN ('in_progress', 'pending_review');