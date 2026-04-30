import { z } from "zod";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Format jam HH:MM atau HH:MM:SS");

export const upsertScheduleSchema = z
  .object({
    employeeId: z.uuid(),
    scheduleDate: dateString,
    startTime: timeString
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
    endTime: timeString
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
    dayOff: z.boolean(),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((s) => (s && s.length > 0 ? s : null)),
  })
  .refine(
    (v) =>
      v.dayOff
        ? v.startTime === null && v.endTime === null
        : v.startTime !== null && v.endTime !== null,
    {
      message:
        "Day-off tidak boleh ada jam; non-day-off butuh start_time + end_time",
      path: ["dayOff"],
    },
  );

export const listSchedulesSchema = z.object({
  from: dateString,
  to: dateString,
  employeeId: z.uuid().optional(),
});
