import "server-only";

import type { EmailMessage } from "../send";

/**
 * Sesi AE-62o — email template untuk approval code shift rebalancing.
 *
 * Mirror struktur ApprovalCodeEmail (sesi AE-19) tapi context dapat shift
 * rebalance, bukan transaction. Owner terima kode 6-digit, forward ke
 * kasir/manager untuk approve correction.
 */
export interface ShiftRebalanceEmailInput {
  toEmail: string;
  ownerName: string;
  /** 6-digit code (plaintext for email body — only the hash is stored). */
  code: string;
  /** Shift label, mis. "Shift 4bf2... ditutup 16/05/2026 23:17". */
  shiftLabel: string;
  /** Cashier name dari shift. */
  cashierName: string;
  /** Per-channel correction details (original → corrected). */
  changes: Array<{
    label: string;
    originalValue: number;
    correctedValue: number;
  }>;
  /** Reason dari requester. */
  reason: string;
  /** Requester display name + role. */
  requestedByName: string;
  requestedByRole: string;
  /** Source: dari close shift atau backoffice manager. */
  source: "close_shift" | "manager_backoffice";
  /** Wall-clock expiry. */
  expiresAt: Date;
  /** Outlet display name. */
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

const SOURCE_LABEL: Record<string, string> = {
  close_shift: "saat tutup shift",
  manager_backoffice: "dari backoffice manager",
};

export function buildShiftRebalanceCodeEmail(
  input: ShiftRebalanceEmailInput,
): EmailMessage {
  const subject = `[Mahakan POS] Kode Approval Rebalancing Shift — ${input.shiftLabel}`;
  const sourceLabel = SOURCE_LABEL[input.source] ?? input.source;

  const changesText = input.changes
    .map(
      (c) =>
        `  - ${c.label}: Rp ${fmtRupiah(c.originalValue)} → Rp ${fmtRupiah(c.correctedValue)} (selisih ${c.correctedValue >= c.originalValue ? "+" : ""}${fmtRupiah(c.correctedValue - c.originalValue)})`,
    )
    .join("\n");

  const text = [
    `Halo ${input.ownerName},`,
    "",
    `${input.requestedByName} (${input.requestedByRole}) di ${input.outletName} minta approval untuk REBALANCING shift:`,
    `  Shift: ${input.shiftLabel}`,
    `  Kasir: ${input.cashierName}`,
    `  Diajukan ${sourceLabel}`,
    "",
    "Perubahan yang diminta:",
    changesText,
    "",
    `Alasan: ${input.reason}`,
    "",
    `KODE: ${input.code}`,
    "",
    `Berlaku sampai ${fmtTime(input.expiresAt)} WIB (1 jam). Single-use.`,
    "",
    `Setelah Anda approve, sistem akan:`,
    `  - Update shift fields ke nilai corrected`,
    `  - Reverse journal variance lama (kalau ada)`,
    `  - Post journal variance baru sesuai corrected values`,
    `  - Tercatat di audit log dengan reason + approver`,
    "",
    `Forward kode ini ke ${input.requestedByName} via WhatsApp untuk approve.`,
    "",
    `Kalau bukan kamu yang minta, ABAIKAN email ini — code expired sendiri.`,
    "",
    `— Mahakan POS`,
  ].join("\n");

  const changesHtml = input.changes
    .map((c) => {
      const diff = c.correctedValue - c.originalValue;
      const color = diff === 0 ? "#777" : diff > 0 ? "#15803d" : "#b91c1c";
      return `<tr>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${c.label}</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; color: #555;">Rp ${fmtRupiah(c.originalValue)}</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: center; color: #777;">→</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; font-weight: bold;">Rp ${fmtRupiah(c.correctedValue)}</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; color: ${color}; font-weight: bold;">${diff >= 0 ? "+" : ""}${fmtRupiah(diff)}</td>
      </tr>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 24px auto; color: #1a1a1a;">
  <p>Halo <strong>${input.ownerName}</strong>,</p>
  <p>
    <strong>${input.requestedByName}</strong> (${input.requestedByRole}) di
    ${input.outletName} minta approval untuk <strong>REBALANCING SHIFT</strong>:
  </p>
  <div style="background: #f4f4f0; padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 16px;">
    <strong>Shift:</strong> ${input.shiftLabel}<br/>
    <strong>Kasir:</strong> ${input.cashierName}<br/>
    <em>Diajukan ${sourceLabel}</em>
  </div>
  <p style="font-size: 13px; color: #555; margin-bottom: 4px;">Perubahan yang diminta:</p>
  <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
    <thead>
      <tr style="background: #f9f9f6; font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.5px;">
        <th style="padding: 6px 8px; text-align: left;">Channel</th>
        <th style="padding: 6px 8px; text-align: right;">Lama</th>
        <th style="padding: 6px 8px;"></th>
        <th style="padding: 6px 8px; text-align: right;">Baru</th>
        <th style="padding: 6px 8px; text-align: right;">Selisih</th>
      </tr>
    </thead>
    <tbody>${changesHtml}</tbody>
  </table>
  <p style="background: #fef9c3; padding: 10px 12px; border-radius: 6px; font-size: 13px; color: #713f12; margin-bottom: 16px;">
    <strong>Alasan:</strong> ${input.reason}
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <div style="font-size: 12px; color: #777; letter-spacing: 1px; margin-bottom: 8px;">KODE APPROVAL</div>
    <div style="font-family: ui-monospace, SFMono-Regular, monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; background: #3D7557; color: #fff; padding: 16px 24px; border-radius: 12px; display: inline-block;">
      ${input.code}
    </div>
    <div style="font-size: 12px; color: #777; margin-top: 12px;">
      Berlaku sampai ${fmtTime(input.expiresAt)} WIB (1 jam). Single-use.
    </div>
  </div>
  <div style="background: #ecfdf5; padding: 12px; border-radius: 8px; font-size: 12px; color: #065f46; margin-bottom: 16px;">
    <strong>Setelah Anda approve:</strong>
    <ul style="margin: 6px 0 0 18px; padding: 0;">
      <li>Update shift fields ke nilai corrected</li>
      <li>Reverse journal variance lama (kalau ada)</li>
      <li>Post journal variance baru sesuai corrected values</li>
      <li>Tercatat di audit log dengan reason + approver</li>
    </ul>
  </div>
  <p style="font-size: 13px; color: #555;">
    Forward kode ini ke ${input.requestedByName} via WhatsApp untuk approve.
  </p>
  <p style="font-size: 12px; color: #888; border-top: 1px solid #e5e3db; padding-top: 12px; margin-top: 32px;">
    Kalau bukan kamu yang minta, abaikan email ini — code expired sendiri.<br/>
    — Mahakan POS
  </p>
</body>
</html>`.trim();

  return { to: input.toEmail, subject, text, html };
}
