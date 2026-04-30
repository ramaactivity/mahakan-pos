import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employeeDocuments, employees, users } from "@/db/schema";
import type {
  Employee,
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
