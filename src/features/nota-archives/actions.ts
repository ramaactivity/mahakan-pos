"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  notaArchiveCategoryValues,
  notaArchiveFiles,
  notaArchiveStatusValues,
  notaArchives,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import {
  getArchiveById,
  getArchiveStats,
  getRecentArchivesByUploader,
  listArchives,
} from "./queries";
import {
  fail,
  ok,
  type AddNotaArchiveFilesInput,
  type ApiResult,
  type CreateNotaArchiveInput,
  type ListNotaArchivesOptions,
  type PublicNotaArchive,
  type PublicNotaArchiveWithFiles,
  type ReviewNotaArchiveInput,
  type UpdateNotaArchiveInput,
} from "./types";

const fileSchema = z.object({
  url: z.url(),
  fileId: z.string().min(1),
  folderId: z.string().nullable(),
  originalName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(80),
  sizeBytes: z.number().int().min(0),
});

const createSchema = z.object({
  notaDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(notaArchiveCategoryValues),
  description: z.string().trim().min(1).max(500),
  amount: z.number().nonnegative().nullable().optional(),
  files: z.array(fileSchema).min(1).max(10),
});

const updateSchema = z.object({
  id: z.uuid(),
  notaDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  category: z.enum(notaArchiveCategoryValues).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  amount: z.number().nonnegative().nullable().optional(),
});

const reviewSchema = z.object({
  id: z.uuid(),
  status: z.enum(notaArchiveStatusValues),
  reviewerNote: z.string().trim().max(500).nullable().optional(),
});

const addFilesSchema = z.object({
  notaArchiveId: z.uuid(),
  files: z.array(fileSchema).min(1).max(10),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

async function requirePerm(perm: Permission) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, perm)) {
    throw new Error(`FORBIDDEN:${perm}`);
  }
  return session;
}

// =========================================================
// READS
// =========================================================

export async function listNotaArchives(
  opts: ListNotaArchivesOptions = {},
): Promise<
  ApiResult<{ items: PublicNotaArchive[]; total: number }>
> {
  const session = await requireSession();
  const canViewAll = hasPermission(session.user.role, "nota_archive.view.all");
  const canViewOwn = hasPermission(session.user.role, "nota_archive.view.own");
  if (!canViewAll && !canViewOwn) {
    return fail("FORBIDDEN", "Tidak punya hak lihat nota");
  }
  /* Staff (canViewOwn only) — di-force filter ke uploader sendiri. */
  const effectiveOpts: ListNotaArchivesOptions = canViewAll
    ? opts
    : { ...opts, uploaderId: session.user.id };
  return ok(await listArchives(session.user.outletId, effectiveOpts));
}

export async function getNotaArchive(
  id: string,
): Promise<ApiResult<PublicNotaArchiveWithFiles>> {
  const session = await requireSession();
  const archive = await getArchiveById(id);
  if (!archive) return fail("NOT_FOUND", "Nota tidak ditemukan");
  if (archive.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  /* Staff hanya bisa lihat nota sendiri. */
  const canViewAll = hasPermission(session.user.role, "nota_archive.view.all");
  if (!canViewAll && archive.createdById !== session.user.id) {
    return fail("FORBIDDEN", "Hanya bisa lihat nota yang lo upload sendiri");
  }
  return ok(archive);
}

export async function getMyRecentNotaArchives(
  limit = 10,
): Promise<ApiResult<PublicNotaArchive[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "nota_archive.view.own")) {
    return fail("FORBIDDEN", "Tidak punya hak");
  }
  return ok(
    await getRecentArchivesByUploader(
      session.user.outletId,
      session.user.id,
      limit,
    ),
  );
}

export async function getNotaArchiveStats(): Promise<
  ApiResult<{
    pendingReview: number;
    reviewedThisMonth: number;
    totalThisMonth: number;
  }>
> {
  const session = await requirePerm("nota_archive.view.all");
  return ok(await getArchiveStats(session.user.outletId));
}

// =========================================================
// CREATE
// =========================================================

export async function createNotaArchive(
  input: CreateNotaArchiveInput,
): Promise<ApiResult<PublicNotaArchiveWithFiles>> {
  const session = await requirePerm("nota_archive.create");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [row] = await db
    .insert(notaArchives)
    .values({
      outletId: session.user.outletId,
      notaDate: v.notaDate,
      category: v.category,
      description: v.description,
      amount: v.amount != null ? String(v.amount) : null,
      status: "pending_review",
      createdBy: session.user.id,
    })
    .returning();

  /* Insert file rows. */
  await db.insert(notaArchiveFiles).values(
    v.files.map((f, idx) => ({
      notaArchiveId: row.id,
      fileUrl: f.url,
      driveFileId: f.fileId,
      driveFolderId: f.folderId,
      originalName: f.originalName,
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
      displayOrder: idx,
    })),
  );

  await logAudit({
    eventType: "nota_archive.create",
    userId: session.user.id,
    entityType: "nota_archive",
    entityId: row.id,
    payload: {
      summary: `Upload nota ${v.category} ${v.notaDate}: ${v.description} (${v.files.length} file)`,
      after: {
        notaDate: v.notaDate,
        category: v.category,
        description: v.description,
        amount: v.amount ?? null,
        fileCount: v.files.length,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  const full = await getArchiveById(row.id);
  if (!full) return fail("INTERNAL", "Gagal load nota setelah create");
  return ok(full);
}

export async function addFilesToNotaArchive(
  input: AddNotaArchiveFilesInput,
): Promise<ApiResult<PublicNotaArchiveWithFiles>> {
  const session = await requirePerm("nota_archive.create");
  const parsed = addFilesSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const archive = await getArchiveById(parsed.data.notaArchiveId);
  if (!archive) return fail("NOT_FOUND", "Nota tidak ditemukan");
  if (archive.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  /* Staff hanya bisa tambah file ke nota sendiri. Owner/Manager bebas. */
  const canViewAll = hasPermission(session.user.role, "nota_archive.view.all");
  if (!canViewAll && archive.createdById !== session.user.id) {
    return fail("FORBIDDEN", "Hanya bisa tambah file ke nota yang lo upload");
  }
  if (archive.files.length + parsed.data.files.length > 10) {
    return fail("LIMIT", "Maksimal 10 file per nota");
  }

  const startOrder = archive.files.length;
  await db.insert(notaArchiveFiles).values(
    parsed.data.files.map((f, idx) => ({
      notaArchiveId: archive.id,
      fileUrl: f.url,
      driveFileId: f.fileId,
      driveFolderId: f.folderId,
      originalName: f.originalName,
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
      displayOrder: startOrder + idx,
    })),
  );
  await db
    .update(notaArchives)
    .set({ updatedAt: new Date(), updatedBy: session.user.id })
    .where(eq(notaArchives.id, archive.id));

  await logAudit({
    eventType: "nota_archive.file.add",
    userId: session.user.id,
    entityType: "nota_archive_file",
    entityId: archive.id,
    payload: {
      summary: `Tambah ${parsed.data.files.length} file ke nota ${archive.description}`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  const refreshed = await getArchiveById(archive.id);
  if (!refreshed) return fail("INTERNAL", "Gagal refresh");
  return ok(refreshed);
}

// =========================================================
// UPDATE / REVIEW / DELETE
// =========================================================

export async function updateNotaArchive(
  input: UpdateNotaArchiveInput,
): Promise<ApiResult<PublicNotaArchiveWithFiles>> {
  const session = await requireSession();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const existing = await getArchiveById(v.id);
  if (!existing) return fail("NOT_FOUND", "Nota tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  /* Staff hanya bisa edit nota sendiri. Owner/Manager bebas. */
  const canViewAll = hasPermission(session.user.role, "nota_archive.view.all");
  if (!canViewAll && existing.createdById !== session.user.id) {
    return fail("FORBIDDEN", "Hanya bisa edit nota yang lo upload");
  }

  const updates: Partial<typeof notaArchives.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.notaDate !== undefined) updates.notaDate = v.notaDate;
  if (v.category !== undefined) updates.category = v.category;
  if (v.description !== undefined) updates.description = v.description;
  if (v.amount !== undefined)
    updates.amount = v.amount === null ? null : String(v.amount);

  await db.update(notaArchives).set(updates).where(eq(notaArchives.id, v.id));

  await logAudit({
    eventType: "nota_archive.update",
    userId: session.user.id,
    entityType: "nota_archive",
    entityId: v.id,
    payload: {
      summary: `Edit nota ${existing.description}`,
      before: existing,
      after: { ...existing, ...v },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  const refreshed = await getArchiveById(v.id);
  if (!refreshed) return fail("INTERNAL", "Gagal refresh");
  return ok(refreshed);
}

export async function reviewNotaArchive(
  input: ReviewNotaArchiveInput,
): Promise<ApiResult<PublicNotaArchiveWithFiles>> {
  const session = await requirePerm("nota_archive.review");
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const existing = await getArchiveById(v.id);
  if (!existing) return fail("NOT_FOUND", "Nota tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  const wasPending = existing.status === "pending_review";
  await db
    .update(notaArchives)
    .set({
      status: v.status,
      reviewerNote: v.reviewerNote ?? null,
      reviewedAt: v.status === "pending_review" ? null : new Date(),
      reviewedBy: v.status === "pending_review" ? null : session.user.id,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(notaArchives.id, v.id));

  await logAudit({
    eventType: v.status === "flagged" ? "nota_archive.flag" : "nota_archive.review",
    userId: session.user.id,
    entityType: "nota_archive",
    entityId: v.id,
    payload: {
      summary:
        v.status === "reviewed"
          ? `Mark sudah dicek: ${existing.description}`
          : v.status === "flagged"
            ? `Mark perlu diperhatikan: ${existing.description}`
            : `Reset ke pending review: ${existing.description}`,
      context: { reviewerNote: v.reviewerNote ?? null, wasPending },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  const refreshed = await getArchiveById(v.id);
  if (!refreshed) return fail("INTERNAL", "Gagal refresh");
  return ok(refreshed);
}

export async function deleteNotaArchive(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  const existing = await getArchiveById(id);
  if (!existing) return fail("NOT_FOUND", "Nota tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  /* Owner/Manager bisa delete apa pun. Staff hanya bisa delete punya
   * sendiri yang belum direview. */
  const canDeleteAll = hasPermission(
    session.user.role,
    "nota_archive.delete",
  );
  if (!canDeleteAll) {
    if (existing.createdById !== session.user.id) {
      return fail("FORBIDDEN", "Hanya bisa hapus nota yang lo upload");
    }
    if (existing.status !== "pending_review") {
      return fail(
        "FORBIDDEN",
        "Nota yang sudah direview hanya bisa dihapus Owner/Manager",
      );
    }
  }

  await db
    .update(notaArchives)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(notaArchives.id, id));

  await logAudit({
    eventType: "nota_archive.delete",
    userId: session.user.id,
    entityType: "nota_archive",
    entityId: id,
    payload: {
      summary: `Hapus nota ${existing.description}`,
      before: existing,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok({ id });
}

/* Silence unused-import warnings on isNull from earlier draft. */
void isNull;
void and;
