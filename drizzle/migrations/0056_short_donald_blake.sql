CREATE INDEX "idx_audit_logs_entity_time" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_je_date_status" ON "journal_entries" USING btree ("outlet_id","entry_date","status");--> statement-breakpoint
CREATE INDEX "idx_cm_outlet_holder" ON "capital_movements" USING btree ("outlet_id","holder_type","holder_id");