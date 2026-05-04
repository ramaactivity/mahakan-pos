-- Phase 4 — Absensi Mobile + Integrity (sesi AB).
--
-- Additive only:
-- (1) employees.attendance_pin_hash — bcrypt hash untuk PIN absensi karyawan,
--     terpisah dari users.pin (POS staff PIN). Karyawan kitchen/cleaning yang
--     tidak punya akun POS tetap punya PIN absensi.
-- (2) attendance_records.* — selfie URL/ID dari Drive, GPS metadata, idempotency
--     ref untuk dedup double-tap.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS attendance_pin_hash text;
--> statement-breakpoint

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS selfie_drive_url text;
--> statement-breakpoint

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS selfie_drive_file_id text;
--> statement-breakpoint

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS gps_lat double precision;
--> statement-breakpoint

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS gps_lng double precision;
--> statement-breakpoint

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS gps_distance_meters integer;
--> statement-breakpoint

-- Idempotency token untuk mobile clock-in/out — dedup double-tap dalam window
-- 60 detik. Nullable karena legacy records dari kiosk admin tidak punya.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS client_ref_id uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_attendance_client_ref
  ON attendance_records (client_ref_id)
  WHERE client_ref_id IS NOT NULL;
