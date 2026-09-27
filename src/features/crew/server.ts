import "server-only";

import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, employees } from "@/db/schema";
import type { CrewRef, PosCrew } from "./types";

/* A shift can run past midnight, so "on duty" = an attendance record still
 * open that started recently, not "clocked in on today's date". */
const ON_DUTY_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * Sesi AE-235 — crew list for the POS chip picker. Everyone clocked in comes
 * first; every other active employee is still selectable (flagged) so a crew
 * member who forgot to clock in never blocks a sale.
 */
export async function fetchPosCrew(outletId: string): Promise<PosCrew[]> {
  const [staff, open] = await Promise.all([
    db
      .select({ id: employees.id, fullName: employees.fullName, nickname: employees.nickname })
      .from(employees)
      .where(
        and(
          eq(employees.outletId, outletId),
          eq(employees.status, "active"),
          isNull(employees.deletedAt),
        ),
      ),
    db
      .select({ employeeId: attendanceRecords.employeeId })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.outletId, outletId),
          isNull(attendanceRecords.clockOutAt),
          gte(attendanceRecords.clockInAt, new Date(Date.now() - ON_DUTY_WINDOW_MS)),
        ),
      ),
  ]);
  const onDuty = new Set(open.map((r) => r.employeeId));
  return staff
    .map((e) => ({ id: e.id, name: e.nickname?.trim() || e.fullName, onDuty: onDuty.has(e.id) }))
    .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name, "id"));
}

export type CrewCheck =
  | { ok: true; crew: CrewRef | null }
  | { ok: false; code: "CREW_REQUIRED" | "CREW_INVALID"; message: string };

/**
 * Validate the crew chip sent with a POS action. Required unless the caller
 * explicitly allows a missing crew (offline-queue replays from before AE-235,
 * owner approving from the back office).
 */
export async function resolveCrew(
  outletId: string,
  crewId: string | null | undefined,
  opts: { allowMissing?: boolean } = {},
): Promise<CrewCheck> {
  if (!crewId) {
    return opts.allowMissing
      ? { ok: true, crew: null }
      : { ok: false, code: "CREW_REQUIRED", message: "Pilih nama crew yang melayani dulu." };
  }
  const crew = (await fetchPosCrew(outletId)).find((c) => c.id === crewId);
  if (!crew) {
    return { ok: false, code: "CREW_INVALID", message: "Crew tidak ditemukan atau sudah tidak aktif. Pilih ulang." };
  }
  return { ok: true, crew };
}

/** Spread into logAudit metadata. */
export function crewMeta(crew: CrewRef | null): { crew: CrewRef } | Record<string, never> {
  return crew ? { crew } : {};
}

/** Appended to audit summaries so the crew shows in the Audit Log list. */
export function crewSuffix(crew: CrewRef | null): string {
  return crew ? ` · crew: ${crew.name}` : "";
}
