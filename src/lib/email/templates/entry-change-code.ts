import "server-only";

import type { EmailMessage } from "../send";

/**
 * Sesi AE-67 — email template untuk approval code entry change
 * (pengeluaran/pemasukan edit/delete dengan suggest staff → approve owner).
 *
 * Mirror struktur shift-rebalance-code (sesi AE-62o).
 */
export interface EntryChangeEmailInput {
  toEmail: string;
  ownerName: string;
  /** 6-digit plaintext code (only hash stored in DB). */
  code: string;
  operation: "update" | "delete";
  entityType: "expense" | "income";
  /** Summary text dari entry asli (mis. "Pengeluaran Rp 72.000 — Nasi 8 pcs"). */
  originalSummary: string;
  /** Data baru yang diusulkan (null kalau delete). */
  proposedData: Record<string, unknown> | null;
  /** Alasan dari requester. */
  reason: string;
  requestedByName: string;
  requestedByRole: string;
  expiresAt: Date;
  outletName: string;
}

function fmtRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

function summarizeProposedDiff(
  proposed: Record<string, unknown> | null,
): string[] {
  if (!proposed) return ["(hapus entry — tidak ada data baru)"];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(proposed)) {
    if (value == null) continue;
    const label =
      key === "amount"
        ? "Nominal"
        : key === "description"
          ? "Deskripsi"
          : key === "expenseDate"
            ? "Tanggal"
            : key === "incomeDate"
              ? "Tanggal"
              : key === "categoryId"
                ? "Kategori (id)"
                : key === "paymentMethod"
                  ? "Metode"
                  : key;
    const formatted =
      typeof value === "number" && key === "amount"
        ? `Rp ${fmtRupiah(value)}`
        : String(value);
    lines.push(`${label}: ${formatted}`);
  }
  return lines.length > 0 ? lines : ["(tidak ada perubahan terdeteksi)"];
}

export function buildEntryChangeCodeEmail(
  input: EntryChangeEmailInput,
): EmailMessage {
  const opLabel = input.operation === "delete" ? "HAPUS" : "EDIT";
  const entityLabel = input.entityType === "expense" ? "Pengeluaran" : "Pemasukan";
  const subject = `[Mahakan POS] Kode Approval — ${opLabel} ${entityLabel}`;
  const expiryTime = fmtTime(input.expiresAt);
  const proposedLines = summarizeProposedDiff(input.proposedData);

  const textBody = [
    `Hi ${input.ownerName},`,
    "",
    `Ada permintaan ${opLabel.toLowerCase()} ${entityLabel.toLowerCase()} di ${input.outletName}.`,
    "",
    `KODE APPROVAL: ${input.code}`,
    `Berlaku sampai: ${expiryTime} WIB`,
    "",
    `Entry asli: ${input.originalSummary}`,
    "",
    input.operation === "delete"
      ? "Aksi: HAPUS entry ini (soft-delete, audit trail tersimpan)."
      : `Aksi: EDIT dengan perubahan:`,
    ...(input.operation === "update" ? proposedLines.map((l) => `  - ${l}`) : []),
    "",
    `Diajukan oleh: ${input.requestedByName} (${input.requestedByRole})`,
    `Alasan: ${input.reason}`,
    "",
    `Cara approve:`,
    `1. Buka Back Office → Shifts → Pending Approvals`,
    `2. Cari koreksi entry dari ${input.requestedByName}`,
    `3. Klik Approve → masukkan kode 6-digit di atas`,
    "",
    `Atau reject kalau tidak setuju (sertakan alasan).`,
    "",
    `Kalau bukan kamu yang minta, IGNORE email ini. Kode akan expired otomatis.`,
    "",
    `— Mahakan POS`,
  ].join("\n");

  const htmlBody = `<!DOCTYPE html><html><body style="font-family: -apple-system, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #1a4d2e; margin: 0 0 8px;">Kode Approval — ${opLabel} ${entityLabel}</h2>
    <p style="margin: 0 0 16px; color: #555;">Hi ${input.ownerName}, ada permintaan koreksi entry ${entityLabel.toLowerCase()} di <strong>${input.outletName}</strong>.</p>

    <div style="background: #f0f9f3; border: 2px solid #1a4d2e; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
      <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #1a4d2e;">Kode Approval</p>
      <p style="margin: 8px 0 4px; font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a4d2e;">${input.code}</p>
      <p style="margin: 0; font-size: 11px; color: #1a4d2e;">Berlaku sampai ${expiryTime} WIB</p>
    </div>

    <div style="background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px; margin: 12px 0;">
      <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Entry Asli</p>
      <p style="margin: 0; font-size: 14px;">${input.originalSummary}</p>
    </div>

    <div style="background: ${input.operation === "delete" ? "#fef2f2" : "#fffbeb"}; border: 1px solid ${input.operation === "delete" ? "#fca5a5" : "#fcd34d"}; border-radius: 6px; padding: 12px; margin: 12px 0;">
      <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${input.operation === "delete" ? "#991b1b" : "#92400e"};">Aksi Diusulkan</p>
      ${
        input.operation === "delete"
          ? `<p style="margin: 0; font-size: 14px;">HAPUS entry ini (soft-delete dengan audit trail)</p>`
          : `<ul style="margin: 0; padding-left: 20px; font-size: 14px;">${proposedLines.map((l) => `<li>${l}</li>`).join("")}</ul>`
      }
    </div>

    <div style="margin: 12px 0;">
      <p style="margin: 0 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Diajukan oleh</p>
      <p style="margin: 0; font-size: 14px;">${input.requestedByName} (${input.requestedByRole})</p>
    </div>

    <div style="margin: 12px 0;">
      <p style="margin: 0 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Alasan</p>
      <p style="margin: 0; font-size: 14px; font-style: italic;">${input.reason}</p>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />

    <p style="margin: 0; font-size: 12px; color: #666;">
      <strong>Cara approve:</strong> Buka Back Office → Shifts → Pending Approvals → masukkan kode di atas.
      Reject kalau tidak setuju (sertakan alasan). Kalau bukan kamu yang minta, ignore email ini.
    </p>
  </body></html>`;

  return {
    to: input.toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  };
}
