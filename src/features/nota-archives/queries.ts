import "server-only";
import { and, asc, desc, eq, gte, ilike, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notaArchiveFiles,
  notaArchives,
} from "@/db/schema";
import {
  toPublicArchive,
  toPublicFile,
  type ListNotaArchivesOptions,
  type PublicNotaArchive,
  type PublicNotaArchiveWithFiles,
} from "./types";

export async function listArchives(
  outletId: string,
  opts: ListNotaArchivesOptions = {},
): Promise<{ items: PublicNotaArchive[]; total: number }> {
  const conds = [
    eq(notaArchives.outletId, outletId),
    isNull(notaArchives.deletedAt),
  ];
  if (opts.status) conds.push(eq(notaArchives.status, opts.status));
  if (opts.category) conds.push(eq(notaArchives.category, opts.category));
  if (opts.dateFrom) conds.push(gte(notaArchives.notaDate, opts.dateFrom));
  if (opts.dateTo) conds.push(lte(notaArchives.notaDate, opts.dateTo));
  if (opts.uploaderId) conds.push(eq(notaArchives.createdBy, opts.uploaderId));
  if (opts.search && opts.search.trim().length > 0) {
    conds.push(ilike(notaArchives.description, `%${opts.search.trim()}%`));
  }

  /* Total count untuk paginator. */
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notaArchives)
    .where(and(...conds));
  const total = totalRow?.c ?? 0;

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  /* Correlated subqueries untuk nama uploader/reviewer + jumlah file.
   *
   * PENTING: outer-column harus di-qualify literal `nota_archives.*`.
   * Kalau pakai interpolasi Drizzle `${notaArchives.id}` / `${notaArchives.createdBy}`,
   * Drizzle me-render kolom POLOS tanpa prefix tabel (`"id"`, `"created_by"`)
   * di posisi SELECT-field. Akibatnya di dalam subquery nama itu ke-tangkap
   * oleh kolom inner yang namanya sama (nota_archive_files.id, users.created_by)
   * → count selalu 0, nama selalu null. Lihat sesi AE-161. */
  const rows = await db
    .select({
      archive: notaArchives,
      createdByName: sql<string>`(SELECT u.name FROM users u WHERE u.id = nota_archives.created_by)`,
      reviewedByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = nota_archives.reviewed_by)`,
      fileCount: sql<number>`(SELECT count(*)::int FROM nota_archive_files f WHERE f.nota_archive_id = nota_archives.id)`,
    })
    .from(notaArchives)
    .where(and(...conds))
    .orderBy(desc(notaArchives.notaDate), desc(notaArchives.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map((r) =>
      toPublicArchive(
        r.archive,
        r.createdByName ?? "—",
        r.reviewedByName,
        Number(r.fileCount ?? 0),
      ),
    ),
    total,
  };
}

export async function getArchiveById(
  id: string,
): Promise<PublicNotaArchiveWithFiles | null> {
  const [row] = await db
    .select({
      archive: notaArchives,
      createdByName: sql<string>`(SELECT u.name FROM users u WHERE u.id = nota_archives.created_by)`,
      reviewedByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = nota_archives.reviewed_by)`,
    })
    .from(notaArchives)
    .where(and(eq(notaArchives.id, id), isNull(notaArchives.deletedAt)))
    .limit(1);
  if (!row) return null;
  const files = await db
    .select()
    .from(notaArchiveFiles)
    .where(eq(notaArchiveFiles.notaArchiveId, id))
    .orderBy(asc(notaArchiveFiles.displayOrder), asc(notaArchiveFiles.createdAt));
  const base = toPublicArchive(
    row.archive,
    row.createdByName ?? "—",
    row.reviewedByName,
    files.length,
  );
  return { ...base, files: files.map(toPublicFile) };
}

export async function getRecentArchivesByUploader(
  outletId: string,
  uploaderId: string,
  limit = 10,
): Promise<PublicNotaArchive[]> {
  const { items } = await listArchives(outletId, { uploaderId, limit });
  return items;
}

export async function getArchiveStats(
  outletId: string,
): Promise<{
  pendingReview: number;
  reviewedThisMonth: number;
  totalThisMonth: number;
}> {
  /* "This month" anchored ke WIB today. */
  const wibToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const monthStart = `${wibToday.slice(0, 7)}-01`;

  const [pending] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notaArchives)
    .where(
      and(
        eq(notaArchives.outletId, outletId),
        eq(notaArchives.status, "pending_review"),
        isNull(notaArchives.deletedAt),
      ),
    );
  const [reviewed] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notaArchives)
    .where(
      and(
        eq(notaArchives.outletId, outletId),
        eq(notaArchives.status, "reviewed"),
        gte(notaArchives.notaDate, monthStart),
        isNull(notaArchives.deletedAt),
      ),
    );
  const [total] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notaArchives)
    .where(
      and(
        eq(notaArchives.outletId, outletId),
        gte(notaArchives.notaDate, monthStart),
        isNull(notaArchives.deletedAt),
      ),
    );

  return {
    pendingReview: pending?.c ?? 0,
    reviewedThisMonth: reviewed?.c ?? 0,
    totalThisMonth: total?.c ?? 0,
  };
}
