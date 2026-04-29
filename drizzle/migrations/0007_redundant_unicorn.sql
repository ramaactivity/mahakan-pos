CREATE TABLE "approval_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"code_first_two" text NOT NULL,
	"action_type" text NOT NULL,
	"target_transaction_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" uuid,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_approval_codes_first_two_format" CHECK ("approval_codes"."code_first_two" ~ '^[0-9]{2}$'),
	CONSTRAINT "ck_approval_codes_failed_attempts_nonneg" CHECK ("approval_codes"."failed_attempts" >= 0),
	CONSTRAINT "ck_approval_codes_consumed_pair" CHECK (("approval_codes"."consumed_at" IS NULL AND "approval_codes"."consumed_by_user_id" IS NULL) OR ("approval_codes"."consumed_at" IS NOT NULL AND "approval_codes"."consumed_by_user_id" IS NOT NULL)),
	CONSTRAINT "ck_approval_codes_revoked_pair" CHECK (("approval_codes"."revoked_at" IS NULL AND "approval_codes"."revoked_by_user_id" IS NULL) OR ("approval_codes"."revoked_at" IS NOT NULL AND "approval_codes"."revoked_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_target_transaction_id_transactions_id_fk" FOREIGN KEY ("target_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_codes" ADD CONSTRAINT "approval_codes_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_approval_codes_lookup" ON "approval_codes" USING btree ("target_transaction_id","action_type","consumed_at");--> statement-breakpoint
CREATE INDEX "idx_approval_codes_outlet_created" ON "approval_codes" USING btree ("outlet_id","created_at");