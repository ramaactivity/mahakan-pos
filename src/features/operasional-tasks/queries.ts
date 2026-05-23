import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  operasionalTaskCompletions,
  operasionalTaskTemplates,
  operasionalTaskWaExports,
  users,
} from "@/db/schema";
import type {
  OperasionalFrequency,
  OperasionalSection,
} from "@/db/schema/operasional_tasks";
import {
  currentPeriodKey,
  formatPeriodLabel,
  SECTION_LABELS,
} from "./period";
import { DEFAULT_SEED_GROUPS } from "./seed";
import {
  toPublicCompletion,
  toPublicTemplate,
  type ChecklistEntry,
  type ChecklistPeriodView,
  type PublicTaskTemplate,
} from "./types";

/**
 * Lazy seed: kalau outlet belum punya template apapun, isi dengan
 * default list (`DEFAULT_SEED_GROUPS`). Idempotent — di-skip kalau
 * sudah ada minimal 1 row template (aktif/non-aktif). Owner tetap bisa
 * delete (soft) lalu seed lagi via tombol "Pulihkan default" di admin.
 */
export async function seedDefaultTemplatesIfEmpty(
  outletId: string,
): Promise<{ inserted: number }> {
  const [existing] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(operasionalTaskTemplates)
    .where(
      and(
        eq(operasionalTaskTemplates.outletId, outletId),
        isNull(operasionalTaskTemplates.deletedAt),
      ),
    );
  if ((existing?.c ?? 0) > 0) return { inserted: 0 };

  const rows = DEFAULT_SEED_GROUPS.flatMap((g) =>
    g.tasks.map((t, idx) => ({
      outletId,
      section: g.section,
      frequency: g.frequency,
      title: t.title,
      description: t.description ?? null,
      displayOrder: idx,
      isActive: true,
      isSeed: true,
    })),
  );
  if (rows.length === 0) return { inserted: 0 };
  await db.insert(operasionalTaskTemplates).values(rows);
  return { inserted: rows.length };
}

export async function listTemplatesForOutlet(
  outletId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<PublicTaskTemplate[]> {
  const conds = [
    eq(operasionalTaskTemplates.outletId, outletId),
    isNull(operasionalTaskTemplates.deletedAt),
  ];
  if (!opts.includeInactive) {
    conds.push(eq(operasionalTaskTemplates.isActive, true));
  }
  const rows = await db
    .select()
    .from(operasionalTaskTemplates)
    .where(and(...conds))
    .orderBy(
      asc(operasionalTaskTemplates.frequency),
      asc(operasionalTaskTemplates.section),
      asc(operasionalTaskTemplates.displayOrder),
      asc(operasionalTaskTemplates.title),
    );
  return rows.map(toPublicTemplate);
}

export async function fetchTemplateById(
  id: string,
): Promise<PublicTaskTemplate | null> {
  const [row] = await db
    .select()
    .from(operasionalTaskTemplates)
    .where(
      and(
        eq(operasionalTaskTemplates.id, id),
        isNull(operasionalTaskTemplates.deletedAt),
      ),
    )
    .limit(1);
  return row ? toPublicTemplate(row) : null;
}

/**
 * Ambil view checklist period — active templates untuk (frequency) +
 * completion rows pada periodKey. Hasil di-group per section dengan
 * progress count.
 */
export async function getChecklistPeriodView(
  outletId: string,
  frequency: OperasionalFrequency,
  periodKey: string,
): Promise<ChecklistPeriodView> {
  await seedDefaultTemplatesIfEmpty(outletId);

  const templates = await db
    .select()
    .from(operasionalTaskTemplates)
    .where(
      and(
        eq(operasionalTaskTemplates.outletId, outletId),
        eq(operasionalTaskTemplates.frequency, frequency),
        eq(operasionalTaskTemplates.isActive, true),
        isNull(operasionalTaskTemplates.deletedAt),
      ),
    )
    .orderBy(
      asc(operasionalTaskTemplates.section),
      asc(operasionalTaskTemplates.displayOrder),
      asc(operasionalTaskTemplates.title),
    );

  const completions = await db
    .select({
      completion: operasionalTaskCompletions,
      completedByName: users.name,
    })
    .from(operasionalTaskCompletions)
    .innerJoin(users, eq(users.id, operasionalTaskCompletions.completedBy))
    .where(
      and(
        eq(operasionalTaskCompletions.outletId, outletId),
        eq(operasionalTaskCompletions.frequency, frequency),
        eq(operasionalTaskCompletions.periodKey, periodKey),
      ),
    );

  const completionByTemplate = new Map(
    completions.map((c) => [
      c.completion.templateId,
      toPublicCompletion(c.completion, c.completedByName),
    ]),
  );

  /* Group per section, retaining sort order. */
  const sectionsMap = new Map<
    OperasionalSection,
    { entries: ChecklistEntry[]; done: number; total: number }
  >();
  for (const row of templates) {
    const tmpl = toPublicTemplate(row);
    const section = tmpl.section;
    if (!sectionsMap.has(section)) {
      sectionsMap.set(section, { entries: [], done: 0, total: 0 });
    }
    const bucket = sectionsMap.get(section)!;
    const completion = completionByTemplate.get(tmpl.id) ?? null;
    bucket.entries.push({ template: tmpl, completion });
    bucket.total += 1;
    if (completion) bucket.done += 1;
  }

  /* Last WA export pada period ini (untuk label "Sudah dikirim X jam lalu"). */
  const [lastExport] = await db
    .select({
      exportedAt: operasionalTaskWaExports.exportedAt,
      exportedByName: users.name,
    })
    .from(operasionalTaskWaExports)
    .innerJoin(users, eq(users.id, operasionalTaskWaExports.exportedBy))
    .where(
      and(
        eq(operasionalTaskWaExports.outletId, outletId),
        eq(operasionalTaskWaExports.frequency, frequency),
        eq(operasionalTaskWaExports.periodKey, periodKey),
      ),
    )
    .orderBy(desc(operasionalTaskWaExports.exportedAt))
    .limit(1);

  /* Stable section order — preferred: bar, kitchen, general (UX). */
  const order: OperasionalSection[] = ["bar", "kitchen", "general"];
  const sections = order
    .filter((s) => sectionsMap.has(s))
    .map((s) => {
      const b = sectionsMap.get(s)!;
      return {
        section: s,
        entries: b.entries,
        completedCount: b.done,
        totalCount: b.total,
      };
    });

  return {
    frequency,
    periodKey,
    periodLabel: formatPeriodLabel(frequency, periodKey),
    sections,
    lastWaExportAt: lastExport?.exportedAt ?? null,
    lastWaExportBy: lastExport?.exportedByName ?? null,
  };
}

/** Untuk cron jobs — agregat progress per outlet per frequency. */
export async function getCompletionProgress(
  outletId: string,
  frequency: OperasionalFrequency,
  periodKey?: string,
): Promise<{ done: number; total: number; periodKey: string }> {
  const pk = periodKey ?? currentPeriodKey(frequency);
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(operasionalTaskTemplates)
    .where(
      and(
        eq(operasionalTaskTemplates.outletId, outletId),
        eq(operasionalTaskTemplates.frequency, frequency),
        eq(operasionalTaskTemplates.isActive, true),
        isNull(operasionalTaskTemplates.deletedAt),
      ),
    );
  const [doneRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(operasionalTaskCompletions)
    .where(
      and(
        eq(operasionalTaskCompletions.outletId, outletId),
        eq(operasionalTaskCompletions.frequency, frequency),
        eq(operasionalTaskCompletions.periodKey, pk),
      ),
    );
  return {
    done: doneRow?.c ?? 0,
    total: totalRow?.c ?? 0,
    periodKey: pk,
  };
}

export { SECTION_LABELS };
