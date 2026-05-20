DROP INDEX "ux_shifts_user_active";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_shifts_outlet_active" ON "shifts" USING btree ("outlet_id") WHERE "shifts"."status" = 'open';