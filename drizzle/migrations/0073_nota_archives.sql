CREATE TABLE "nota_archive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nota_archive_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"drive_folder_id" text,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nota_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"nota_date" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(15, 2),
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewer_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_nota_archives_desc_nonempty" CHECK (length(trim("nota_archives"."description")) > 0),
	CONSTRAINT "ck_nota_archives_amount_pos" CHECK ("nota_archives"."amount" IS NULL OR "nota_archives"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "nota_archive_files" ADD CONSTRAINT "nota_archive_files_nota_archive_id_nota_archives_id_fk" FOREIGN KEY ("nota_archive_id") REFERENCES "public"."nota_archives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_archives" ADD CONSTRAINT "nota_archives_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_archives" ADD CONSTRAINT "nota_archives_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_archives" ADD CONSTRAINT "nota_archives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_archives" ADD CONSTRAINT "nota_archives_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_nota_archive_files_archive" ON "nota_archive_files" USING btree ("nota_archive_id");--> statement-breakpoint
CREATE INDEX "idx_nota_archives_outlet_date" ON "nota_archives" USING btree ("outlet_id","nota_date");--> statement-breakpoint
CREATE INDEX "idx_nota_archives_outlet_status" ON "nota_archives" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "idx_nota_archives_outlet_category" ON "nota_archives" USING btree ("outlet_id","category");