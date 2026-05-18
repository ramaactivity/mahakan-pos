CREATE TABLE "journal_retry_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"hook_label" text NOT NULL,
	"hook_args" jsonb NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"last_error" text NOT NULL,
	"last_error_stack" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp with time zone,
	"last_retry_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolved_journal_entry_id" uuid,
	"abandoned_at" timestamp with time zone,
	"abandoned_by_user_id" uuid,
	"abandoned_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_journal_retry_count_nonneg" CHECK ("journal_retry_queue"."retry_count" >= 0),
	CONSTRAINT "ck_journal_retry_terminal_xor" CHECK (NOT ("journal_retry_queue"."resolved_at" IS NOT NULL AND "journal_retry_queue"."abandoned_at" IS NOT NULL)),
	CONSTRAINT "ck_journal_retry_resolved_pair" CHECK (("journal_retry_queue"."resolved_at" IS NULL AND "journal_retry_queue"."resolved_by_user_id" IS NULL) OR ("journal_retry_queue"."resolved_at" IS NOT NULL AND "journal_retry_queue"."resolved_by_user_id" IS NOT NULL)),
	CONSTRAINT "ck_journal_retry_abandoned_pair" CHECK (("journal_retry_queue"."abandoned_at" IS NULL AND "journal_retry_queue"."abandoned_by_user_id" IS NULL AND "journal_retry_queue"."abandoned_reason" IS NULL)
       OR ("journal_retry_queue"."abandoned_at" IS NOT NULL AND "journal_retry_queue"."abandoned_by_user_id" IS NOT NULL AND length(trim("journal_retry_queue"."abandoned_reason")) >= 3))
);
--> statement-breakpoint
ALTER TABLE "journal_retry_queue" ADD CONSTRAINT "journal_retry_queue_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_retry_queue" ADD CONSTRAINT "journal_retry_queue_last_retry_by_user_id_users_id_fk" FOREIGN KEY ("last_retry_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_retry_queue" ADD CONSTRAINT "journal_retry_queue_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_retry_queue" ADD CONSTRAINT "journal_retry_queue_abandoned_by_user_id_users_id_fk" FOREIGN KEY ("abandoned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_journal_retry_outlet_pending" ON "journal_retry_queue" USING btree ("outlet_id") WHERE "journal_retry_queue"."resolved_at" IS NULL AND "journal_retry_queue"."abandoned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_journal_retry_source" ON "journal_retry_queue" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_journal_retry_created" ON "journal_retry_queue" USING btree ("created_at");