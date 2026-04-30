import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeCareerHistory,
  employeeDocuments,
  employees,
  users,
} from "@/db/schema";
import type {
  Employee,
  EmployeeCareerHistoryEntry,
  EmployeeDocument,
  EmployeeStatus,
  EmployeeWithLink,
  Paginated,
} from "./types";

export interface ListEmployeesOptions {
  outletId: string;
  status?: EmployeeStatus | "all";
  search?: string;
  limit?: number;
}

/** Fetches employees with linked user info + a per-row count of
 * non-deleted document rows. Single query via subselect for the count. */
export async function fetchEmployees(
  opts: ListEmployeesOptions,
): Promise<Paginated<EmployeeWithLink>> {
  const limit = opts.limit ?? 100;
  const conds = [
    eq(employees.outletId, opts.outletId),
    isNull(employees.deletedAt),
  ];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(employees.status, opts.status));
  }
  if (opts.search) {
    const like = `%${opts.search.toLowerCase()}%`;
    conds.push(
      sql`(lower(${employees.fullName}) like ${like}
        OR lower(coalesce(${employees.nickname}, '')) like ${like}
        OR lower(coalesce(${employees.position}, '')) like ${like}
        OR lower(coalesce(${employees.employeeNumber}, '')) like ${like})`,
    );
  }

  const rows = await db
    .select({
      employee: employees,
      linkedUserName: users.name,
      linkedUserEmail: users.email,
      documentsCount: sql<number>`(
        SELECT count(*)::int FROM ${employeeDocuments}
        WHERE ${employeeDocuments.employeeId} = ${employees.id}
          AND ${employeeDocuments.deletedAt} IS NULL
      )`,
    })
    .from(employees)
    .leftJoin(users, eq(employees.userId, users.id))
    .where(and(...conds))
    .orderBy(asc(employees.fullName))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: sliced.map((r) => ({
      ...r.employee,
      linkedUserName: r.linkedUserName,
      linkedUserEmail: r.linkedUserEmail,
      documentsCount: r.documentsCount,
    })),
    total: rows.length,
    hasMore,
  };
}

export async function fetchEmployeeById(
  id: string,
): Promise<Employee | null> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function fetchEmployeeDocuments(
  employeeId: string,
): Promise<EmployeeDocument[]> {
  return db
    .select()
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.employeeId, employeeId),
        isNull(employeeDocuments.deletedAt),
      ),
    )
    .orderBy(desc(employeeDocuments.createdAt));
}

export interface ExpiringDocument extends EmployeeDocument {
  employeeFullName: string;
  employeeNickname: string | null;
}

/** Documents expiring within the next `daysAhead` days OR already expired,
 * for active employees in the outlet. Sorted ascending so the most urgent
 * (already-expired or expiring soonest) come first. */
export async function fetchExpiringDocuments(
  outletId: string,
  daysAhead: number = 30,
): Promise<ExpiringDocument[]> {
  // `date + integer` returns date in Postgres — cleaner than interval-cast
  // and works directly with parameterized integer.
  const days = Math.max(0, Math.floor(daysAhead));
  const rows = await db
    .select({
      doc: employeeDocuments,
      employeeFullName: employees.fullName,
      employeeNickname: employees.nickname,
    })
    .from(employeeDocuments)
    .innerJoin(
      employees,
      and(
        eq(employees.id, employeeDocuments.employeeId),
        eq(employees.outletId, outletId),
        isNull(employees.deletedAt),
        eq(employees.status, "active"),
      ),
    )
    .where(
      and(
        isNull(employeeDocuments.deletedAt),
        sql`${employeeDocuments.expiresAt} IS NOT NULL`,
        sql`${employeeDocuments.expiresAt} <= (CURRENT_DATE + ${days}::int)`,
      ),
    )
    .orderBy(asc(employeeDocuments.expiresAt));
  return rows.map((r) => ({
    ...r.doc,
    employeeFullName: r.employeeFullName,
    employeeNickname: r.employeeNickname,
  }));
}

/** Career history entries for an employee, newest first. */
export async function fetchEmployeeCareerHistory(
  employeeId: string,
): Promise<EmployeeCareerHistoryEntry[]> {
  return db
    .select()
    .from(employeeCareerHistory)
    .where(
      and(
        eq(employeeCareerHistory.employeeId, employeeId),
        isNull(employeeCareerHistory.deletedAt),
      ),
    )
    .orderBy(
      desc(employeeCareerHistory.effectiveDate),
      desc(employeeCareerHistory.createdAt),
    );
}
