CREATE TABLE "ingredient_cost_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"old_cost_per_unit" bigint,
	"new_cost_per_unit" bigint NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_ref_type" text,
	"trigger_ref_id" uuid,
	"changed_qty" numeric(15, 4),
	"changed_value" bigint,
	"actor_id" uuid,
	"notes" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ingredient_cost_history_costs_nonneg" CHECK ("ingredient_cost_history"."new_cost_per_unit" >= 0 AND ("ingredient_cost_history"."old_cost_per_unit" IS NULL OR "ingredient_cost_history"."old_cost_per_unit" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ingredient_cost_history" ADD CONSTRAINT "ingredient_cost_history_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_cost_history" ADD CONSTRAINT "ingredient_cost_history_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_cost_history" ADD CONSTRAINT "ingredient_cost_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ingredient_cost_history_ingredient_date" ON "ingredient_cost_history" USING btree ("ingredient_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_ingredient_cost_history_outlet_date" ON "ingredient_cost_history" USING btree ("outlet_id","changed_at");