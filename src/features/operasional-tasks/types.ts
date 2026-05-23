import type {
  OperasionalFrequency,
  OperasionalSection,
  OperasionalTaskCompletion,
  OperasionalTaskTemplate,
} from "@/db/schema/operasional_tasks";

export type { OperasionalFrequency, OperasionalSection };

/** API result shape — match users module convention. */
export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

/** Template row sanitized untuk klien (drop deletedAt). */
export interface PublicTaskTemplate {
  id: string;
  outletId: string;
  section: OperasionalSection;
  frequency: OperasionalFrequency;
  title: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  isSeed: boolean;
}

/** Completion row sanitized untuk klien. */
export interface PublicTaskCompletion {
  id: string;
  templateId: string;
  periodKey: string;
  completedAt: Date;
  completedById: string;
  completedByName: string;
  isLate: boolean;
  lateReason: string | null;
  notes: string | null;
}

/** Combined view per template untuk page render. */
export interface ChecklistEntry {
  template: PublicTaskTemplate;
  completion: PublicTaskCompletion | null;
}

export interface ChecklistPeriodView {
  frequency: OperasionalFrequency;
  periodKey: string;
  periodLabel: string;
  /** Grouped per section. Section yang tidak punya template apapun tidak hadir. */
  sections: Array<{
    section: OperasionalSection;
    entries: ChecklistEntry[];
    completedCount: number;
    totalCount: number;
  }>;
  /** WA export timestamps untuk period ini — last export only. */
  lastWaExportAt: Date | null;
  lastWaExportBy: string | null;
}

export interface CreateTemplateInput {
  section: OperasionalSection;
  frequency: OperasionalFrequency;
  title: string;
  description?: string | null;
}

export interface UpdateTemplateInput {
  id: string;
  title?: string;
  description?: string | null;
  section?: OperasionalSection;
  isActive?: boolean;
  displayOrder?: number;
}

export interface ToggleCompletionInput {
  templateId: string;
  periodKey: string;
  /** True = mark complete, false = uncheck (delete row). */
  done: boolean;
  notes?: string | null;
  /** Required kalau periodKey adalah past period. */
  lateReason?: string | null;
}

export interface RecordWaExportInput {
  frequency: OperasionalFrequency;
  periodKey: string;
  section: OperasionalSection | null;
  completedCount: number;
  totalCount: number;
}

export function toPublicTemplate(
  row: OperasionalTaskTemplate,
): PublicTaskTemplate {
  return {
    id: row.id,
    outletId: row.outletId,
    section: row.section as OperasionalSection,
    frequency: row.frequency as OperasionalFrequency,
    title: row.title,
    description: row.description,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    isSeed: row.isSeed,
  };
}

export function toPublicCompletion(
  row: OperasionalTaskCompletion,
  completedByName: string,
): PublicTaskCompletion {
  return {
    id: row.id,
    templateId: row.templateId,
    periodKey: row.periodKey,
    completedAt: row.completedAt,
    completedById: row.completedBy,
    completedByName,
    isLate: row.isLate,
    lateReason: row.lateReason,
    notes: row.notes,
  };
}
