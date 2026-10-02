import { z } from "zod";

const optionalNote = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((s) => (s && s.length > 0 ? s : null));

export const clockInSchema = z.object({
  employeeId: z.uuid(),
  notes: optionalNote,
});

export const clockOutSchema = z.object({
  recordId: z.uuid(),
  notes: optionalNote,
});

export const listAttendanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employeeId: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Sesi AE-63 phase8 — HR Bayu request: edit isLate / lateMinutes /
 * overtimeMinutes per record manual untuk handle special cases
 * (konfirmasi izin, sakit, force majeure). Owner / Manager only.
 *
 * - isLate: "yes" | "no" | "unknown" — same enum as DB
 * - lateMinutes: 0..720 (12 jam max sebagai sanity cap)
 * - overtimeMinutes: 0..720
 * - reason: wajib (min 3 char) supaya audit trail jelas alasan override
 *
 * Server akan:
 *  1. Replace clockInAt/clockOutAt? TIDAK — pisahkan dari clock event.
 *  2. Force-set isLate, lateMinutes, overtimeMinutes ke nilai dari input.
 *  3. Set manualEditAt + manualEditBy + manualEditReason untuk audit.
 *  4. Subsequent recompute (schedule edit etc) AKAN OVERWRITE manual
 *     edit kecuali kita guard di recompute action. Phase 8 simple: no
 *     guard. Future: respect manualEditAt > scheduleUpdatedAt.
 */
export const editAttendanceManualSchema = z.object({
  recordId: z.uuid(),
  isLate: z.enum(["yes", "no", "unknown"]),
  lateMinutes: z
    .number()
    .int()
    .min(0)
    .max(720)
    .nullable(),
  overtimeMinutes: z
    .number()
    .int()
    .min(0)
    .max(720)
    .nullable(),
  reason: z.string().trim().min(3).max(500),
});

export type EditAttendanceManualInput = z.infer<typeof editAttendanceManualSchema>;

/**
 * Sesi AE-162 — HR Bayu request: CREATE attendance record manual untuk hari
 * yang tidak ada clock-in (status "alpa"). Use case:
 *  1. Backfill absen historis (tgl 1–13 sebelum app dipakai).
 *  2. Koreksi hari yang staff lupa clock-in tapi sebenarnya hadir.
 *
 * Server menurunkan clockInAt/clockOutAt + workMinutes dari shift terjadwal
 * hari itu (kalau ada). HR cuma perlu konfirmasi + alasan; opsional set
 * telat/lembur. Record ditandai is_manual_entry=true (tanpa selfie/GPS).
 */
export const createManualAttendanceSchema = z.object({
  employeeId: z.uuid(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isLate: z.enum(["yes", "no", "unknown"]).default("no"),
  lateMinutes: z.number().int().min(0).max(720).nullable().default(0),
  overtimeMinutes: z.number().int().min(0).max(720).nullable().default(0),
  /* Sesi AE-244 — jam masuk & pulang SEBENARNYA ("HH:mm").
   *
   * Kalau diisi, server menghitung sendiri telat + lemburnya memakai helper
   * yang sama dengan clock-in dan recompute jadwal. Sebelumnya HR mengetik
   * menitnya tangan, dan karena jamnya diturunkan dari jadwal, angkanya
   * praktis selalu 0 — hari yang diinput manual tidak pernah terbaca telat
   * maupun lembur. Dibiarkan opsional supaya backfill lama tetap jalan. */
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/, "Jam harus HH:MM").nullish(),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/, "Jam harus HH:MM").nullish(),
  reason: z.string().trim().min(3).max(500),
});
export type CreateManualAttendanceInput = z.infer<
  typeof createManualAttendanceSchema
>;

/**
 * Sesi AE-162 — hapus entri absen yang DIBUAT manual oleh HR (revert ke
 * Alpa). Hanya is_manual_entry=true yang boleh dihapus — record clock-in
 * asli (ada selfie/GPS) aman dari penghapusan.
 */
export const deleteManualAttendanceSchema = z.object({
  recordId: z.uuid(),
  reason: z.string().trim().max(500).nullish(),
});
export type DeleteManualAttendanceInput = z.infer<
  typeof deleteManualAttendanceSchema
>;

/**
 * Sesi AE-162 — backfill massal: tandai HADIR semua hari Alpa (terjadwal
 * kerja, tanggal sudah lewat, belum ada record) dalam satu rentang tanggal.
 * Power-tool buat mock data historis 1–13 tanpa klik per sel.
 */
export const bulkBackfillAttendanceSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Kosong / undefined = semua karyawan aktif di outlet. */
  employeeIds: z.array(z.uuid()).optional(),
  isLate: z.enum(["yes", "no", "unknown"]).default("no"),
  reason: z.string().trim().min(3).max(500),
});
export type BulkBackfillAttendanceInput = z.infer<
  typeof bulkBackfillAttendanceSchema
>;
