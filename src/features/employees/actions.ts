"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeeDocuments } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  fetchEmployeeById,
  fetchEmployeeDocuments,
  fetchEmployees,
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
