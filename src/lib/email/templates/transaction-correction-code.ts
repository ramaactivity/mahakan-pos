import "server-only";

import type { EmailMessage } from "../send";

/**
 * Sesi AE-62r — email template untuk approval code Koreksi Transaksi POS.
 *
 * Mirror struktur shift-rebalance-code (sesi AE-62o) tapi context per-transaksi
 * (paymentMethod/total swap), bukan shift-level. Owner terima kode 6-digit,
 * forward ke kasir/manager untuk approve correction. Setelah approve, sistem
 * reverse original pos_sale journal + post pos_sale_correction entry baru.
 */
export interface TransactionCorrectionEmailInput {
  toEmail: string;
  ownerName: string;
  /** 6-digit code (plaintext for email body — only the hash is stored). */
  code: string;
  /** Transaction label, mis. "TRX-20260518-0007 (Rp 75.000)". */
  transactionLabel: string;
  /** Cashier name dari shift. */
  cashierName: string;
  /** Per-field correction details. */
  changes: Array<{
    label: string;
    originalValue: string;
    correctedValue: string;
  }>;
  /** Reason dari requester. */
  reason: string;
  /** Requester display name + role. */
  requestedByName: string;
  requestedByRole: string;
  /** Source: dari shift aktif atau shift terakhir <24h. */
  source: "kasir_active_shift" | "kasir_post_close" | "manager_backoffice";
  /** Wall-clock expiry. */
  expiresAt: Date;
  /** Outlet display name. */
  outletName: string;
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

const SOURCE_LABEL: Record<string, string> = {
  kasir_active_shift: "dari shift yang masih aktif",
  kasir_post_close: "dari shift terakhir (sudah ditutup <24 jam)",
  manager_backoffice: "dari backoffice manager",
};

export function buildTransactionCorrectionCodeEmail(
  input: TransactionCorrectionEmailInput,
): EmailMessage {
  const subject = `[Mahakan POS] Kode Approval Koreksi Transaksi — ${input.transactionLabel}`;
  const sourceLabel = SOURCE_LABEL[input.source] ?? input.source;

  const changesText = input.changes
    .map((c) => `  - ${c.label}: ${c.originalValue} → ${c.correctedValue}`)
    .join("\n");

  const text = [
    `Halo ${input.ownerName},`,
    "",
    `${input.requestedByName} (${input.requestedByRole}) di ${input.outletName} minta approval untuk KOREKSI TRANSAKSI:`,
    `  Transaksi: ${input.transactionLabel}`,
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
    `  - Update transaksi ke paymentMethod / total baru`,
    `  - Reverse journal pos_sale lama (saldo kembali ke pre-sale)`,
    `  - Post journal pos_sale_correction sesuai nilai baru`,
    `  - Re-calculate loyalty points kalau total berubah`,
    `  - Tercatat di audit log dengan reason + approver`,
    "",
    `Forward kode ini ke ${input.requestedByName} via WhatsApp untuk approve.`,
    "",
    `Kalau bukan kamu yang minta, ABAIKAN email ini — code expired sendiri.`,
    "",
    `— Mahakan POS`,
  ].join("\n");

  const changesHtml = input.changes
    .map(
      (c) => `<tr>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${c.label}</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; color: #555;">${c.originalValue}</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: center; color: #777;">→</td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; font-family: monospace; font-weight: bold;">${c.correctedValue}</td>
      </tr>`,
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 24px auto; color: #1a1a1a;">
  <p>Halo <strong>${input.ownerName}</strong>,</p>
  <p>
    <strong>${input.requestedByName}</strong> (${input.requestedByRole}) di
    ${input.outletName} minta approval untuk <strong>KOREKSI TRANSAKSI</strong>:
  </p>
  <div style="background: #f4f4f0; padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 16px;">
    <strong>Transaksi:</strong> ${input.transactionLabel}<br/>
    <strong>Kasir:</strong> ${input.cashierName}<br/>
    <em>Diajukan ${sourceLabel}</em>
  </div>
  <p style="font-size: 13px; color: #555; margin-bottom: 4px;">Perubahan yang diminta:</p>
  <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 16px;">
    <thead>
      <tr style="background: #f9f9f6; font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.5px;">
        <th style="padding: 6px 8px; text-align: left;">Field</th>
        <th style="padding: 6px 8px; text-align: right;">Lama</th>
        <th style="padding: 6px 8px;"></th>
        <th style="padding: 6px 8px; text-align: right;">Baru</th>
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
      <li>Update transaksi ke paymentMethod / total baru</li>
      <li>Reverse journal pos_sale lama (saldo kembali ke pre-sale)</li>
      <li>Post journal pos_sale_correction sesuai nilai baru</li>
      <li>Re-calculate loyalty points kalau total berubah</li>
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
