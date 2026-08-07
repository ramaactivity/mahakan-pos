"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeCareerHistory, employeeDocuments } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { todayJakarta } from "@/lib/tz";
import {
  fetchEmployeeById,
  fetchEmployeeCareerHistory,
  fetchEmployeeDocuments,
  fetchEmployees,
  fetchExpiringDocuments,
  type ExpiringDocument,
  type ListEmployeesOptions,
} from "./queries";
import {
  createCareerHistoryEntrySchema,
  createEmployeeDocumentSchema,
  createEmployeeSchema,
  updateEmployeeDocumentSchema,
  updateEmployeeSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateCareerHistoryEntryInput,
  type EmployeeCareerHistoryEntry,
  type CreateEmployeeDocumentInput,
  type CreateEmployeeInput,
  type Employee,
  type EmployeeDocument,
  type EmployeeWithLink,
  type Paginated,
  type UpdateEmployeeDocumentInput,
  type UpdateEmployeeInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Build a human-friendly note string describing what changed in a career
 * history entry. Used by auto-detection in updateEmployee. */
function buildCareerChangeNote(
  before: { position: string | null; department: string | null; employmentType: string | null; salaryAmount: number | null },
  after: { position: string | null; department: string | null; employmentType: string | null; salaryAmount: number | null },
): string {
  const parts: string[] = [];
  if (before.position !== after.position) {
    parts.push(`Posisi: ${before.position ?? "—"} → ${after.position ?? "—"}`);
  }
  if (before.department !== after.department) {
    parts.push(`Departemen: ${before.department ?? "—"} → ${after.department ?? "—"}`);
  }
  if (before.employmentType !== after.employmentType) {
    parts.push(`Tipe: ${before.employmentType ?? "—"} → ${after.employmentType ?? "—"}`);
  }
  if (before.salaryAmount !== after.salaryAmount) {
    const fmt = (n: number | null) =>
      n === null ? "—" : `Rp ${n.toLocaleString("id-ID")}`;
    parts.push(`Gaji: ${fmt(before.salaryAmount)} → ${fmt(after.salaryAmount)}`);
  }
  return parts.join(" · ") || "Perubahan data karyawan";
}

function isUniqueViolation(e: unknown, hint?: string): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message.toLowerCase();
  if (!/unique|duplicate/.test(m)) return false;
  return hint ? m.includes(hint) : true;
}

// ---------- Reads ----------

export async function listEmployees(
  opts: Omit<ListEmployeesOptions, "outletId"> = {},
): Promise<ApiResult<Paginated<EmployeeWithLink>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data karyawan");
  }
  return ok(
    await fetchEmployees({ ...opts, outletId: session.user.outletId }),
  );
}

export async function getEmployee(
  id: string,
): Promise<ApiResult<Employee>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data karyawan");
  }
  const row = await fetchEmployeeById(id);
  if (!row) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (row.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  return ok(row);
}

export async function listEmployeeDocuments(
  employeeId: string,
): Promise<ApiResult<EmployeeDocument[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data karyawan");
  }
  const emp = await fetchEmployeeById(employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  return ok(await fetchEmployeeDocuments(employeeId));
}

export async function listEmployeeCareerHistory(
  employeeId: string,
): Promise<ApiResult<EmployeeCareerHistoryEntry[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data karyawan");
  }
  const emp = await fetchEmployeeById(employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  return ok(await fetchEmployeeCareerHistory(employeeId));
}

export async function listExpiringDocuments(
  daysAhead: number = 30,
): Promise<ApiResult<ExpiringDocument[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat data karyawan");
  }
  return ok(
    await fetchExpiringDocuments(session.user.outletId, daysAhead),
  );
}

// ---------- Mutations ----------

export async function createEmployee(
  input: CreateEmployeeInput,
): Promise<ApiResult<Employee>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat karyawan");
  }

  const parsed = createEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const [row] = await db
      .insert(employees)
      .values({
        outletId: session.user.outletId,
        fullName: v.fullName,
        nickname: v.nickname,
        nik: v.nik,
        email: v.email,
        phone: v.phone,
        address: v.address,
        dateOfBirth: v.dateOfBirth,
        employeeNumber: v.employeeNumber,
        position: v.position,
        department: v.department,
        hireDate: v.hireDate,
        employmentType: v.employmentType,
        paymentType: v.paymentType,
        salaryAmount: v.salaryAmount,
        dailyRate: v.dailyRate,
        userId: v.userId,
        notes: v.notes,
        createdBy: session.user.id,
      })
      .returning();

    // Sesi L — seed initial career history entry on hire date so the
    // timeline starts populated. Uses hireDate if provided, else today.
    const initialEffective =
      row.hireDate ?? todayJakarta();
    await db.insert(employeeCareerHistory).values({
      employeeId: row.id,
      effectiveDate: initialEffective,
      position: row.position,
      department: row.department,
      employmentType: row.employmentType,
      paymentType: row.paymentType,
      salaryAmount: row.salaryAmount,
      dailyRate: row.dailyRate,
      note: "Bergabung",
      source: "auto",
      createdBy: session.user.id,
    });

    logAudit({
      eventType: "employee.create",
      userId: session.user.id,
      entityType: "employee",
      entityId: row.id,
      payload: {
        summary: `Karyawan baru: ${row.fullName}${row.position ? ` (${row.position})` : ""}`,
        after: {
          fullName: row.fullName,
          position: row.position,
          department: row.department,
          employmentType: row.employmentType,
          hireDate: row.hireDate,
          linkedUserId: row.userId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit employee.create]", e));

    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e, "user")) {
      return fail(
        "USER_ALREADY_LINKED",
        "User itu sudah ke-link ke karyawan lain",
        "userId",
      );
    }
    if (isUniqueViolation(e, "employee_number")) {
      return fail(
        "EMPLOYEE_NUMBER_TAKEN",
        "Nomor karyawan sudah dipakai di outlet ini",
        "employeeNumber",
      );
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "DB error");
  }
}

export async function updateEmployee(
  input: UpdateEmployeeInput,
): Promise<ApiResult<Employee>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }

  const parsed = updateEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const current = await fetchEmployeeById(v.id);
  if (!current) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  // Detect career-relevant changes BEFORE the update so we can log the
  // pre-change snapshot if needed. Sesi AE-60 — include paymentType + dailyRate.
  const careerChanged =
    v.position !== current.position ||
    v.department !== current.department ||
    v.employmentType !== current.employmentType ||
    v.salaryAmount !== current.salaryAmount ||
    v.paymentType !== current.paymentType ||
    v.dailyRate !== current.dailyRate;

  try {
    const [row] = await db
      .update(employees)
      .set({
        fullName: v.fullName,
        nickname: v.nickname,
        nik: v.nik,
        email: v.email,
        phone: v.phone,
        address: v.address,
        dateOfBirth: v.dateOfBirth,
        employeeNumber: v.employeeNumber,
        position: v.position,
        department: v.department,
        hireDate: v.hireDate,
        employmentType: v.employmentType,
        paymentType: v.paymentType,
        salaryAmount: v.salaryAmount,
        dailyRate: v.dailyRate,
        userId: v.userId,
        notes: v.notes,
        status: v.status ?? current.status,
        resignedAt: v.resignedAt ? new Date(v.resignedAt) : current.resignedAt,
        resignReason: v.resignReason ?? current.resignReason,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(employees.id, v.id))
      .returning();

    // Sesi L — auto-record career history when role-relevant fields change.
    if (careerChanged) {
      const today = todayJakarta();
      await db.insert(employeeCareerHistory).values({
        employeeId: row.id,
        effectiveDate: today,
        position: row.position,
        department: row.department,
        employmentType: row.employmentType,
        paymentType: row.paymentType,
        salaryAmount: row.salaryAmount,
        dailyRate: row.dailyRate,
        note: buildCareerChangeNote(current, row),
        source: "auto",
        createdBy: session.user.id,
      });
    }

    logAudit({
      eventType: "employee.update",
      userId: session.user.id,
      entityType: "employee",
      entityId: row.id,
      payload: {
        summary: `Edit karyawan ${row.fullName}`,
        before: {
          status: current.status,
          position: current.position,
          salaryAmount: current.salaryAmount,
        },
        after: {
          status: row.status,
          position: row.position,
          salaryAmount: row.salaryAmount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit employee.update]", e));

    return ok(row);
  } catch (e) {
    if (isUniqueViolation(e, "user")) {
      return fail(
        "USER_ALREADY_LINKED",
        "User itu sudah ke-link ke karyawan lain",
        "userId",
      );
    }
    if (isUniqueViolation(e, "employee_number")) {
      return fail(
        "EMPLOYEE_NUMBER_TAKEN",
        "Nomor karyawan sudah dipakai di outlet ini",
        "employeeNumber",
      );
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "DB error");
  }
}

export async function deleteEmployee(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus karyawan");
  }
  const current = await fetchEmployeeById(id);
  if (!current) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (current.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  await db
    .update(employees)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(employees.id, id));

  logAudit({
    eventType: "employee.delete",
    userId: session.user.id,
    entityType: "employee",
    entityId: id,
    payload: {
      summary: `Hapus karyawan ${current.fullName}`,
      before: {
        fullName: current.fullName,
        position: current.position,
        status: current.status,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit employee.delete]", e));

  return ok({ id });
}

// ---------- Documents ----------

export async function createEmployeeDocument(
  input: CreateEmployeeDocumentInput,
): Promise<ApiResult<EmployeeDocument>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }
  const parsed = createEmployeeDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const emp = await fetchEmployeeById(v.employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  const [row] = await db
    .insert(employeeDocuments)
    .values({
      employeeId: v.employeeId,
      docType: v.docType,
      title: v.title,
      fileUrl: v.fileUrl,
      expiresAt: v.expiresAt,
      notes: v.notes,
      createdBy: session.user.id,
    })
    .returning();

  return ok(row);
}

export async function updateEmployeeDocument(
  input: UpdateEmployeeDocumentInput,
): Promise<ApiResult<EmployeeDocument>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }
  const parsed = updateEmployeeDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [row] = await db
    .update(employeeDocuments)
    .set({
      docType: v.docType,
      title: v.title,
      fileUrl: v.fileUrl,
      expiresAt: v.expiresAt,
      notes: v.notes,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(employeeDocuments.id, v.id),
        eq(employeeDocuments.employeeId, v.employeeId),
      ),
    )
    .returning();

  if (!row) return fail("NOT_FOUND", "Dokumen tidak ditemukan");
  return ok(row);
}

export async function deleteEmployeeDocument(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }
  await db
    .update(employeeDocuments)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(employeeDocuments.id, id));
  return ok({ id });
}

// ---------- Career History — Sesi M ----------

/** Manually backfill a career history entry — Owner adds historical
 * promo / role change that pre-dated the system. source='manual' so it
 * shows distinctly from auto-tracked rows. */
export async function createCareerHistoryEntry(
  input: CreateCareerHistoryEntryInput,
): Promise<ApiResult<EmployeeCareerHistoryEntry>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }
  const parsed = createCareerHistoryEntrySchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const emp = await fetchEmployeeById(v.employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  const [row] = await db
    .insert(employeeCareerHistory)
    .values({
      employeeId: v.employeeId,
      effectiveDate: v.effectiveDate,
      position: v.position ?? null,
      department: v.department ?? null,
      employmentType: v.employmentType ?? null,
      salaryAmount: v.salaryAmount ?? null,
      note: v.note ?? null,
      source: "manual",
      createdBy: session.user.id,
    })
    .returning();

  logAudit({
    eventType: "career_history.create",
    userId: session.user.id,
    entityType: "employee_career_history",
    entityId: row.id,
    payload: {
      summary: `Backfill riwayat karir ${emp.fullName}: ${row.position ?? "—"} (${row.effectiveDate})`,
    },
  }).catch((e) => console.error("[audit career_history.create]", e));

  return ok(row);
}

/** Soft-delete a career history entry. Used to clean up accidental
 * auto-records or wrong manual entries. Audit-logged. */
export async function deleteCareerHistoryEntry(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit karyawan");
  }

  // Fetch the entry + parent employee for audit + outlet authorization.
  const [entry] = await db
    .select()
    .from(employeeCareerHistory)
    .where(eq(employeeCareerHistory.id, id))
    .limit(1);
  if (!entry) return fail("NOT_FOUND", "Entry tidak ditemukan");

  const emp = await fetchEmployeeById(entry.employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  await db
    .update(employeeCareerHistory)
    .set({ deletedAt: new Date() })
    .where(eq(employeeCareerHistory.id, id));

  logAudit({
    eventType: "career_history.delete",
    userId: session.user.id,
    entityType: "employee_career_history",
    entityId: id,
    payload: {
      summary: `Hapus riwayat karir ${emp.fullName}: ${entry.position ?? "—"} (${entry.effectiveDate})`,
      before: {
        position: entry.position,
        department: entry.department,
        salaryAmount: entry.salaryAmount,
        source: entry.source,
      },
    },
  }).catch((e) => console.error("[audit career_history.delete]", e));

  return ok({ id });
}

// ---------- Phase 4 (sesi AB) — Attendance PIN management ----------

/**
 * Set or update the bcrypt-hashed attendance PIN for a karyawan. PIN dipakai
 * untuk login mobile route `/absenkaryawan`. Validate 4-6 digit angka. Audit
 * logged tanpa expose hash.
 */
export async function setAttendancePin(
  employeeId: string,
  pin: string,
): Promise<ApiResult<{ employeeId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.attendance_pin.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak set PIN absensi");
  }

  if (!/^\d{4,6}$/.test(pin)) {
    return fail("VALIDATION", "PIN harus 4-6 digit angka");
  }

  const emp = await fetchEmployeeById(employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }
  if (emp.deletedAt !== null) {
    return fail("EMPLOYEE_DELETED", "Karyawan sudah dihapus");
  }

  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash(pin, 10);

  await db
    .update(employees)
    .set({
      attendancePinHash: hash,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(employees.id, employeeId));

  await logAudit({
    eventType: "employee.attendance_pin.set",
    userId: session.user.id,
    entityType: "employee",
    entityId: employeeId,
    payload: {
      summary: `Set PIN absensi untuk ${emp.fullName}`,
      // Tidak expose PIN atau hash di audit log — security
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit attendance_pin.set]", e));

  return ok({ employeeId });
}

/**
 * Reset (clear) attendance PIN. Karyawan tidak bisa absen sampai PIN baru
 * di-set. Dipakai saat PIN ke-leak / karyawan resign / lupa PIN.
 */
export async function resetAttendancePin(
  employeeId: string,
): Promise<ApiResult<{ employeeId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.attendance_pin.manage")) {
    return fail("FORBIDDEN", "Tidak punya hak reset PIN absensi");
  }

  const emp = await fetchEmployeeById(employeeId);
  if (!emp) return fail("NOT_FOUND", "Karyawan tidak ditemukan");
  if (emp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Karyawan dari outlet lain");
  }

  await db
    .update(employees)
    .set({
      attendancePinHash: null,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(employees.id, employeeId));

  await logAudit({
    eventType: "employee.attendance_pin.reset",
    userId: session.user.id,
    entityType: "employee",
    entityId: employeeId,
    payload: {
      summary: `Reset PIN absensi untuk ${emp.fullName}`,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit attendance_pin.reset]", e));

  return ok({ employeeId });
}

// ---------- CSV Export — Sesi M ----------

/** Export all employees to CSV (UTF-8 BOM for Excel). Includes tenure
 * computed from hireDate to current date. Owner-only. */
export async function exportEmployeesCsv(): Promise<
  ApiResult<{ filename: string; csv: string }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "employee.view")) {
    return fail("FORBIDDEN", "Tidak punya hak export karyawan");
  }

  const result = await fetchEmployees({
    outletId: session.user.outletId,
    status: "all",
  });
  const rows = result.items;

  const header = [
    "no",
    "nama_lengkap",
    "panggilan",
    "nomor_karyawan",
    "nik",
    "email",
    "telp",
    "tanggal_lahir",
    "alamat",
    "posisi",
    "departemen",
    "tipe_kepegawaian",
    "tanggal_masuk",
    "lama_bekerja",
    "gaji_bulanan",
    "status",
    "tanggal_resign",
    "alasan_resign",
    "akun_pos",
    "akun_pos_email",
    "jumlah_dokumen",
  ];

  const lines: string[] = [header.join(",")];
  rows.forEach((r, idx) => {
    const tenure = r.hireDate
      ? csvTenure(r.hireDate, r.resignedAt)
      : "";
    const cells = [
      idx + 1,
      r.fullName,
      r.nickname ?? "",
      r.employeeNumber ?? "",
      r.nik ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.dateOfBirth ?? "",
      r.address ?? "",
      r.position ?? "",
      r.department ?? "",
      r.employmentType ?? "",
      r.hireDate ?? "",
      tenure,
      r.salaryAmount ?? "",
      r.status,
      r.resignedAt ? new Date(r.resignedAt).toISOString().slice(0, 10) : "",
      r.resignReason ?? "",
      r.linkedUserName ?? "",
      r.linkedUserEmail ?? "",
      r.documentsCount ?? 0,
    ];
    lines.push(
      cells
        .map((c) => csvEscape(typeof c === "number" ? String(c) : c))
        .join(","),
    );
  });

  // UTF-8 BOM so Excel detects encoding correctly (Indonesian chars).
  const csv = "﻿" + lines.join("\n");
  const stamp = todayJakarta();
  const filename = `karyawan-${stamp}.csv`;

  logAudit({
    eventType: "employee.export_csv",
    userId: session.user.id,
    entityType: "employee",
    payload: {
      summary: `Export ${rows.length} karyawan ke CSV`,
    },
  }).catch((e) => console.error("[audit employee.export_csv]", e));

  return ok({ filename, csv });
}

function csvEscape(s: string): string {
  if (s === "" || s === null || s === undefined) return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvTenure(
  hireIso: string,
  resignedAt: Date | null,
): string {
  const start = new Date(hireIso);
  const end = resignedAt ? new Date(resignedAt) : new Date();
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return "";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const years = Math.floor(days / 365);
  const remDays = days - years * 365;
  const months = Math.floor(remDays / 30);
  if (years > 0) {
    return months > 0 ? `${years} tahun ${months} bulan` : `${years} tahun`;
  }
  if (months > 0) return `${months} bulan`;
  return `${days} hari`;
}
