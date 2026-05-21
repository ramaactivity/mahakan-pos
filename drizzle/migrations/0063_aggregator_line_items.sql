ALTER TABLE "aggregator_settlements" ADD COLUMN "line_items" jsonb;--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ADD COLUMN "line_items_count" integer;