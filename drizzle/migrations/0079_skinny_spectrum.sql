ALTER TABLE "menu_items" ADD COLUMN "cost_hot" bigint;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "cost_iced" bigint;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "ck_menu_items_cost_variant_nonneg" CHECK (("menu_items"."cost_hot" IS NULL OR "menu_items"."cost_hot" >= 0)
        AND ("menu_items"."cost_iced" IS NULL OR "menu_items"."cost_iced" >= 0));