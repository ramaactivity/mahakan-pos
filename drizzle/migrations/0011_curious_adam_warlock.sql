ALTER TABLE "shifts" ADD COLUMN "handover_message" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "edc_settlement" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "gofood_settlement" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "grabfood_settlement" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "shopeefood_settlement" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "ck_shifts_settlements_nonneg" CHECK (("shifts"."edc_settlement" IS NULL OR "shifts"."edc_settlement" >= 0)
        AND ("shifts"."gofood_settlement" IS NULL OR "shifts"."gofood_settlement" >= 0)
        AND ("shifts"."grabfood_settlement" IS NULL OR "shifts"."grabfood_settlement" >= 0)
        AND ("shifts"."shopeefood_settlement" IS NULL OR "shifts"."shopeefood_settlement" >= 0));