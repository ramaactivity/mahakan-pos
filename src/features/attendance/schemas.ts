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
