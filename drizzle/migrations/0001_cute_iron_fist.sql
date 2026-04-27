CREATE TABLE "consumed_approver_tokens" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_consumed_approver_expires" ON "consumed_approver_tokens" USING btree ("expires_at");