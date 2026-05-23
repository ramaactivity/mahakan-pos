"use server";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  operasionalTaskCompletions,
  operasionalTaskTemplates,
  operasionalTaskWaExports,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { currentPeriodKey } from "./period";
import {
  fetchTemplateById,
  getChecklistPeriodView,
  listTemplatesForOutlet,
  seedDefaultTemplatesIfEmpty,
} from "./queries";
import { DEFAULT_SEED_GROUPS } from "./seed";
import {
  fail,
  ok,
  toPublicTemplate,
  type ApiResult,
  type ChecklistPeriodView,
  type CreateTemplateInput,
  type PublicTaskTemplate,
  type RecordWaExportInput,
  type ToggleCompletionInput,
  type UpdateTemplateInput,
} from "./types";

const sectionEnum = z.enum(["bar", "kitchen", "general"]);
const freqEnum = z.enum(["daily", "weekly", "monthly"]);

const createTemplateSchema = z.object({
  section: sectionEnum,
  frequency: freqEnum,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

const updateTemplateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  section: sectionEnum.optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const toggleSchema = z.object({
  templateId: z.uuid(),
  periodKey: z.string().min(4).max(20),
  done: z.boolean(),
  notes: z.string().trim().max(500).nullable().optional(),
  lateReason: z.string().trim().max(500).nullable().optional(),
});

const waExportSchema = z.object({
  frequency: freqEnum,
  periodKey: z.string().min(4).max(20),
  section: sectionEnum.nullable(),
  completedCount: z.number().int().min(0).max(1000),
  totalCount: z.number().int().min(0).max(1000),
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

export async function getChecklist(
  frequency: "daily" | "weekly" | "monthly",
  periodKey?: string,
): Promise<ApiResult<ChecklistPeriodView>> {
  const session = await requirePerm("operasional.task.checklist.view");
  const pk = periodKey ?? currentPeriodKey(frequency);
  const view = await getChecklistPeriodView(
    session.user.outletId,
    frequency,
    pk,
  );
  return ok(view);
}

export async function listTemplates(opts: {
  includeInactive?: boolean;
} = {}): Promise<ApiResult<PublicTaskTemplate[]>> {
  const session = await requirePerm("operasional.task.template.manage");
  await seedDefaultTemplatesIfEmpty(session.user.outletId);
  const items = await listTemplatesForOutlet(session.user.outletId, opts);
  return ok(items);
}

// =========================================================
// TEMPLATE CRUD (Owner + Manager)
// =========================================================

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<ApiResult<PublicTaskTemplate>> {
  const session = await requirePerm("operasional.task.template.manage");
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Append to end of section ordering. */
  const [maxOrder] = await db
    .select({ m: max(operasionalTaskTemplates.displayOrder) })
    .from(operasionalTaskTemplates)
    .where(
      and(
        eq(operasionalTaskTemplates.outletId, session.user.outletId),
        eq(operasionalTaskTemplates.frequency, v.frequency),
        eq(operasionalTaskTemplates.section, v.section),
        isNull(operasionalTaskTemplates.deletedAt),
      ),
    );
  const nextOrder = (maxOrder?.m ?? -1) + 1;

  const [row] = await db
    .insert(operasionalTaskTemplates)
    .values({
      outletId: session.user.outletId,
      section: v.section,
      frequency: v.frequency,
      title: v.title,
      description: v.description ?? null,
      displayOrder: nextOrder,
      isActive: true,
      isSeed: false,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "operasional.task.template.create",
    userId: session.user.id,
    entityType: "operasional_task_template",
    entityId: row.id,
    payload: {
      summary: `Tambah task ${v.frequency}/${v.section}: ${row.title}`,
      after: { ...toPublicTemplate(row) },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicTemplate(row));
}

export async function updateTemplate(
  input: UpdateTemplateInput,
): Promise<ApiResult<PublicTaskTemplate>> {
  const session = await requirePerm("operasional.task.template.manage");
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const existing = await fetchTemplateById(v.id);
  if (!existing) return fail("NOT_FOUND", "Task tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet update ditolak");
  }

  const updates: Partial<typeof operasionalTaskTemplates.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.title !== undefined) updates.title = v.title;
  if (v.description !== undefined) updates.description = v.description;
  if (v.section !== undefined) updates.section = v.section;
  if (v.isActive !== undefined) updates.isActive = v.isActive;
  if (v.displayOrder !== undefined) updates.displayOrder = v.displayOrder;

  const [row] = await db
    .update(operasionalTaskTemplates)
    .set(updates)
    .where(eq(operasionalTaskTemplates.id, v.id))
    .returning();

  await logAudit({
    eventType: "operasional.task.template.update",
    userId: session.user.id,
    entityType: "operasional_task_template",
    entityId: row.id,
    payload: {
      summary: `Update task ${existing.frequency}: ${row.title}`,
      before: existing,
      after: toPublicTemplate(row),
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicTemplate(row));
}

export async function archiveTemplate(
  id: string,
): Promise<ApiResult<PublicTaskTemplate>> {
  const session = await requirePerm("operasional.task.template.manage");
  const existing = await fetchTemplateById(id);
  if (!existing) return fail("NOT_FOUND", "Task tidak ditemukan");
  if (existing.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  const [row] = await db
    .update(operasionalTaskTemplates)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(operasionalTaskTemplates.id, id))
    .returning();
  await logAudit({
    eventType: "operasional.task.template.archive",
    userId: session.user.id,
    entityType: "operasional_task_template",
    entityId: row.id,
    payload: {
      summary: `Hapus task ${existing.frequency}: ${row.title}`,
      before: existing,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok(toPublicTemplate(row));
}

/** Reorder via array of {id, displayOrder} — Owner/Manager only. */
export async function reorderTemplates(
  items: Array<{ id: string; displayOrder: number }>,
): Promise<ApiResult<{ updated: number }>> {
  const session = await requirePerm("operasional.task.template.manage");
  const parsed = z
    .array(z.object({ id: z.uuid(), displayOrder: z.number().int().min(0) }))
    .max(200)
    .safeParse(items);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Payload reorder invalid");
  let updated = 0;
  for (const it of parsed.data) {
    const res = await db
      .update(operasionalTaskTemplates)
      .set({
        displayOrder: it.displayOrder,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(
        and(
          eq(operasionalTaskTemplates.id, it.id),
          eq(operasionalTaskTemplates.outletId, session.user.outletId),
        ),
      )
      .returning({ id: operasionalTaskTemplates.id });
    if (res.length > 0) updated += 1;
  }
  return ok({ updated });
}

/** Pulihkan default seed (untuk Owner kalau habis hapus banyak default). */
export async function restoreDefaultTemplates(): Promise<
  ApiResult<{ inserted: number }>
> {
  const session = await requirePerm("operasional.task.template.manage");
  /* Insert hanya yang title belum ada di outlet (case-insensitive). */
  const existingTitles = (
    await db
      .select({ title: operasionalTaskTemplates.title })
      .from(operasionalTaskTemplates)
      .where(
        and(
          eq(operasionalTaskTemplates.outletId, session.user.outletId),
          isNull(operasionalTaskTemplates.deletedAt),
        ),
      )
  ).map((r) => r.title.toLowerCase());
  const set = new Set(existingTitles);

  const newRows: Array<typeof operasionalTaskTemplates.$inferInsert> = [];
  for (const g of DEFAULT_SEED_GROUPS) {
    for (const [idx, t] of g.tasks.entries()) {
      if (!set.has(t.title.toLowerCase())) {
        newRows.push({
          outletId: session.user.outletId,
          section: g.section,
          frequency: g.frequency,
          title: t.title,
          description: t.description ?? null,
          displayOrder: 1000 + idx, // append after custom rows
          isActive: true,
          isSeed: true,
          createdBy: session.user.id,
        });
      }
    }
  }
  if (newRows.length === 0) return ok({ inserted: 0 });
  await db.insert(operasionalTaskTemplates).values(newRows);
  await logAudit({
    eventType: "operasional.task.template.restore_default",
    userId: session.user.id,
    entityType: "operasional_task_template",
    payload: { summary: `Pulihkan ${newRows.length} default task` },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok({ inserted: newRows.length });
}

// =========================================================
// COMPLETION TOGGLE (semua role yang ber-perm)
// =========================================================

export async function toggleCompletion(
  input: ToggleCompletionInput,
): Promise<ApiResult<{ done: boolean }>> {
  const session = await requirePerm("operasional.task.checklist.do");
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  /* Verify template milik outlet dan masih aktif. */
  const tmpl = await fetchTemplateById(v.templateId);
  if (!tmpl) return fail("NOT_FOUND", "Task tidak ditemukan");
  if (tmpl.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cross-outlet ditolak");
  }
  if (!tmpl.isActive) {
    return fail("INACTIVE", "Task ini sudah di-nonaktifkan");
  }

  const expectedFreqPeriod = currentPeriodKey(tmpl.frequency);
  const isLate = v.periodKey !== expectedFreqPeriod;

  if (!v.done) {
    /* Uncheck: hard delete completion row. */
    const deleted = await db
      .delete(operasionalTaskCompletions)
      .where(
        and(
          eq(operasionalTaskCompletions.templateId, v.templateId),
          eq(operasionalTaskCompletions.periodKey, v.periodKey),
        ),
      )
      .returning({ id: operasionalTaskCompletions.id });
    if (deleted.length > 0) {
      await logAudit({
        eventType: "operasional.task.uncheck",
        userId: session.user.id,
        entityType: "operasional_task_completion",
        entityId: deleted[0].id,
        payload: {
          summary: `Batal centang: ${tmpl.title} (${v.periodKey})`,
        },
        metadata: {
          outletId: session.user.outletId,
          actorRole: session.user.role,
        },
      });
    }
    return ok({ done: false });
  }

  /* Mark done — upsert. Untuk past period, lateReason wajib. */
  if (isLate && (!v.lateReason || v.lateReason.length === 0)) {
    return fail(
      "VALIDATION_ERROR",
      "Wajib isi alasan kalau backdate task lewat hari/minggu/bulannya",
      "lateReason",
    );
  }

  await db
    .insert(operasionalTaskCompletions)
    .values({
      outletId: session.user.outletId,
      templateId: v.templateId,
      frequency: tmpl.frequency,
      periodKey: v.periodKey,
      completedAt: new Date(),
      completedBy: session.user.id,
      isLate,
      lateReason: isLate ? v.lateReason ?? null : null,
      notes: v.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        operasionalTaskCompletions.templateId,
        operasionalTaskCompletions.periodKey,
      ],
      set: {
        completedAt: new Date(),
        completedBy: session.user.id,
        isLate,
        lateReason: isLate ? v.lateReason ?? null : null,
        notes: v.notes ?? null,
        updatedAt: new Date(),
      },
    });

  await logAudit({
    eventType: isLate
      ? "operasional.task.check_late"
      : "operasional.task.check",
    userId: session.user.id,
    entityType: "operasional_task_completion",
    payload: {
      summary: isLate
        ? `Centang terlambat: ${tmpl.title} (${v.periodKey})`
        : `Centang: ${tmpl.title}`,
      context: { lateReason: v.lateReason ?? null, notes: v.notes ?? null },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ done: true });
}

// =========================================================
// WA EXPORT STAMP
// =========================================================

export async function recordWaExport(
  input: RecordWaExportInput,
): Promise<ApiResult<{ id: string }>> {
  const session = await requirePerm("operasional.task.checklist.do");
  const parsed = waExportSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const [row] = await db
    .insert(operasionalTaskWaExports)
    .values({
      outletId: session.user.outletId,
      frequency: v.frequency,
      section: v.section,
      periodKey: v.periodKey,
      exportedBy: session.user.id,
      completedCount: v.completedCount,
      totalCount: v.totalCount,
    })
    .returning({ id: operasionalTaskWaExports.id });
  await logAudit({
    eventType: "operasional.task.wa_export",
    userId: session.user.id,
    entityType: "operasional_task_wa_export",
    entityId: row.id,
    payload: {
      summary: `Kirim ringkasan ${v.frequency} ${v.periodKey} → ${v.completedCount}/${v.totalCount}`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok({ id: row.id });
}

/* Silence unused symbol from import. */
void sql;
