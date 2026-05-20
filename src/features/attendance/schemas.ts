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
