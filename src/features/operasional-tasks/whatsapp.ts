/**
 * Sesi AE-131 — Generator pesan WhatsApp untuk ringkasan ceklist.
 *
 * Pure module (boleh dipakai di client). Pakai pola sama dengan
 * Permintaan Belanja → `wa.me/<phone>?text=<encoded>` lalu open.
 */

import type { ChecklistPeriodView } from "./types";
import { FREQUENCY_LABELS, SECTION_LABELS } from "./period";

const SECTION_EMOJI: Record<string, string> = {
  bar: "🥃",
  kitchen: "🍳",
  general: "🧹",
};

export interface BuildWaTextOpts {
  view: ChecklistPeriodView;
  senderName?: string | null;
  /** Outlet display name (mis. "Mahakan Coffee & Space"). */
  outletName?: string | null;
}

export function buildChecklistWhatsappText(opts: BuildWaTextOpts): string {
  const { view, senderName, outletName } = opts;
  const lines: string[] = [];
  const header = outletName
    ? `*Checklist Operasional — ${outletName}*`
    : `*Checklist Operasional Mahakan*`;
  lines.push(header);
  lines.push(`${view.periodLabel} — ${FREQUENCY_LABELS[view.frequency]}`);
  lines.push("");

  let done = 0;
  let total = 0;

  for (const section of view.sections) {
    /* Show section header kalau ada lebih dari 1 section (weekly).
     * Daily/monthly umumnya 1 section saja → tidak perlu sub-header. */
    if (view.sections.length > 1) {
      const emoji = SECTION_EMOJI[section.section] ?? "•";
      lines.push(`${emoji} *${SECTION_LABELS[section.section]}*`);
    }
    for (const entry of section.entries) {
      total += 1;
      if (entry.completion) {
        done += 1;
        const lateMark = entry.completion.isLate ? " ⏰" : "";
        lines.push(
          `✅ ${entry.template.title} — ${entry.completion.completedByName}${lateMark}`,
        );
        if (entry.completion.notes) {
          lines.push(`   _${entry.completion.notes}_`);
        }
      } else {
        lines.push(`⬜ ${entry.template.title}`);
      }
    }
    if (view.sections.length > 1) lines.push("");
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  lines.push(`Progress: ${done}/${total} (${pct}%)`);
  if (senderName) {
    lines.push("");
    lines.push(`Dikirim oleh: ${senderName}`);
  }
  return lines.join("\n");
}

/**
 * Phone normalizer (selaras dengan BelanjaSubmissionModal): "0812..." atau
 * "+62812..." → "62812..." (wa.me format tanpa leading +).
 */
export function normalizeWaPhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  return digits;
}

export function buildWaLink(text: string, phone: string | null | undefined): string {
  const encoded = encodeURIComponent(text);
  if (!phone) return `https://wa.me/?text=${encoded}`;
  return `https://wa.me/${normalizeWaPhone(phone)}?text=${encoded}`;
}
