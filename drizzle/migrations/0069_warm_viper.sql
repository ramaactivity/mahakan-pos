CREATE TABLE "user_notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"snooze_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_quiet_start_min" integer DEFAULT 1320 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_quiet_end_min" integer DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_subscriptions" ADD CONSTRAINT "user_notification_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_notif_sub" ON "user_notification_subscriptions" USING btree ("user_id","category");