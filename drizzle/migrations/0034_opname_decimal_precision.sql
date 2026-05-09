ALTER TABLE "stock_opname_lines" ADD COLUMN "expected_qty_decimal" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD COLUMN "actual_qty_decimal" numeric(15, 4);