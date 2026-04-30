"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeCareerHistory, employeeDocuments } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
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
  createEmployeeDocumentSchema,
  createEmployeeSchema,
  updateEmployeeDocumentSchema,
  updateEmployeeSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
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
        salaryAmount: v.salaryAmount,
        userId: v.userId,
        notes: v.notes,
        createdBy: session.user.id,
      })
      .returning();

    // Sesi L — seed initial career history entry on hire date so the
    // timeline starts populated. Uses hireDate if provided, else today.
    const initialEffective =
      row.hireDate ?? new Date().toISOString().slice(0, 10);
    await db.insert(employeeCareerHistory).values({
      employeeId: row.id,
      effectiveDate: initialEffective,
      position: row.position,
      department: row.department,
      employmentType: row.employmentType,
      salaryAmount: row.salaryAmount,
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
  // pre-change snapshot if needed.
  const careerChanged =
    v.position !== current.position ||
    v.department !== current.department ||
    v.employmentType !== current.employmentType ||
    v.salaryAmount !== current.salaryAmount;

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
        salaryAmount: v.salaryAmount,
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
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(employeeCareerHistory).values({
        employeeId: row.id,
        effectiveDate: today,
        position: row.position,
        department: row.department,
        employmentType: row.employmentType,
        salaryAmount: row.salaryAmount,
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
