CREATE TABLE "operasional_task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"period_key" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" uuid NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"late_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operasional_task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"section" text NOT NULL,
	"frequency" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ck_op_task_templates_title_nonempty" CHECK (length(trim("operasional_task_templates"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "operasional_task_wa_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"section" text,
	"period_key" text NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_by" uuid NOT NULL,
	"completed_count" integer NOT NULL,
	"total_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operasional_task_completions" ADD CONSTRAINT "operasional_task_completions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_completions" ADD CONSTRAINT "operasional_task_completions_template_id_operasional_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."operasional_task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_completions" ADD CONSTRAINT "operasional_task_completions_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_templates" ADD CONSTRAINT "operasional_task_templates_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_templates" ADD CONSTRAINT "operasional_task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_templates" ADD CONSTRAINT "operasional_task_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_wa_exports" ADD CONSTRAINT "operasional_task_wa_exports_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operasional_task_wa_exports" ADD CONSTRAINT "operasional_task_wa_exports_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_op_task_completions_template_period" ON "operasional_task_completions" USING btree ("template_id","period_key");--> statement-breakpoint
CREATE INDEX "idx_op_task_completions_outlet_period" ON "operasional_task_completions" USING btree ("outlet_id","frequency","period_key");--> statement-breakpoint
CREATE INDEX "idx_op_task_templates_outlet_freq_section" ON "operasional_task_templates" USING btree ("outlet_id","frequency","section");--> statement-breakpoint
CREATE INDEX "idx_op_task_templates_active_order" ON "operasional_task_templates" USING btree ("outlet_id","is_active","display_order");--> statement-breakpoint
CREATE INDEX "idx_op_task_wa_exports_outlet_period" ON "operasional_task_wa_exports" USING btree ("outlet_id","frequency","period_key");