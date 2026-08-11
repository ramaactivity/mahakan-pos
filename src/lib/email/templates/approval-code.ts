import "server-only";

import type { EmailMessage } from "../send";

export interface ApprovalCodeEmailInput {
  toEmail: string;
  /** Owner's display name in greeting. */
  ownerName: string;
  /** "pos.transaction.void" | "pos.transaction.refund" */
  actionType: string;
  /** 6-digit code (plaintext for email body — only the hash is stored). */
  code: string;
  /** Display ID for the transaction (e.g. "20260429-0042").
   * Sesi AE-195 — null untuk `pos.compliment`: kodenya diminta saat
   * keranjang masih di layar, transaksinya belum ada. */
  transactionNumber: string | null;
  /** Total rupiah (display only). Untuk compliment = subtotal keranjang
   * yang akan digratiskan. */
  transactionTotal: number;
  /** Reason staff entered when requesting. */
  reason: string;
  /** Who initiated the request — staff/manager name + role. */
  requestedByName: string;
  requestedByRole: string;
  /** Wall-clock expiry (ISO string). */
  expiresAt: Date;
  /** Outlet display name. */
  outletName: string;
}

const ACTION_LABEL: Record<string, string> = {
  "pos.transaction.void": "Void Transaksi",
  "pos.transaction.refund": "Refund Transaksi",
  "pos.compliment": "Compliment (100% Gratis)",
  "expense.create": "Pengeluaran Kas",
};

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

/**
 * Build the email body. Plain-text is the canonical version (works
 * everywhere); HTML adds a bit of formatting for clients that render it.
 *
 * Body intentionally short — Owner must read code + forward to staff
 * via WhatsApp. We make code block big & easy to grab with one tap.
 */
export function buildApprovalCodeEmail(
  input: ApprovalCodeEmailInput,
): EmailMessage {
  const actionLabel = ACTION_LABEL[input.actionType] ?? input.actionType;
  /* Compliment belum punya nomor transaksi — pakai nilai keranjangnya
   * sebagai penanda supaya owner tetap tahu ini approval untuk apa. */
  const targetLabel = input.transactionNumber
    ? `TRX ${input.transactionNumber}`
    : `Rp ${fmtRupiah(input.transactionTotal)}`;
  const subject = `[Mahakan POS] Kode Approval ${actionLabel} — ${targetLabel}`;

  const text = [
    `Halo ${input.ownerName},`,
    "",
    `${input.requestedByName} (${input.requestedByRole}) di ${input.outletName} minta approval untuk:`,
    `  ${actionLabel} ${targetLabel}${input.transactionNumber ? ` (Rp ${fmtRupiah(input.transactionTotal)})` : ""}`,
    `  Alasan: ${input.reason}`,
    "",
    `KODE: ${input.code}`,
    "",
    `Berlaku sampai ${fmtTime(input.expiresAt)} WIB. Single-use.`,
    "",
    `Forward kode ini ke ${input.requestedByName} via WhatsApp untuk approve.`,
    "",
    `Kalau bukan kamu yang minta, ABAIKAN email ini — code expired sendiri.`,
    "",
    `— Mahakan POS`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 24px auto; color: #1a1a1a;">
  <p>Halo <strong>${input.ownerName}</strong>,</p>
  <p>
    <strong>${input.requestedByName}</strong> (${input.requestedByRole}) di
    ${input.outletName} minta approval untuk:
  </p>
  <p style="background: #f4f4f0; padding: 12px; border-radius: 8px; font-size: 14px;">
    ${actionLabel} <code style="font-family:monospace">${targetLabel}</code>
    ${input.transactionNumber ? `(Rp ${fmtRupiah(input.transactionTotal)})` : ""}<br/>
    <em>Alasan:</em> ${input.reason}
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <div style="font-size: 12px; color: #777; letter-spacing: 1px; margin-bottom: 8px;">KODE APPROVAL</div>
    <div style="font-family: ui-monospace, SFMono-Regular, monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; background: #3D7557; color: #fff; padding: 16px 24px; border-radius: 12px; display: inline-block;">
      ${input.code}
    </div>
    <div style="font-size: 12px; color: #777; margin-top: 12px;">
      Berlaku sampai ${fmtTime(input.expiresAt)} WIB. Single-use.
    </div>
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
