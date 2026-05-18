import "server-only";

import type { EmailMessage } from "../send";

/**
 * Sesi AE-63e — Statement dividen email template untuk investor & pengelola.
 *
 * Dikirim otomatis setelah Owner approve+post distribusi bulanan
 * (after() hook), atau manual resend dari UI Distribusi.
 *
 * Mirror payslip template (sesi AE-62ad) — HTML + plain text, ringkas
 * tanpa fluff. Format Rupiah Indonesia.
 */

export interface InvestorStatementEmailInput {
  toEmail: string;
  holderName: string;
  holderType: "investor" | "pengelola";
  outletName: string;
  periodLabel: string; // "Februari 2026"
  postedAt: Date;
  modalDisetor: number;
  /** %-share dalam pool (investor pool atau pengelola pool). */
  sharePct: number;
  /** Dividen Rupiah period ini. */
  dividendAmount: number;
  /** Optional saldo akumulasi sebelum + sesudah period (kalau dihitung). */
  saldoSebelum?: number | null;
  saldoSesudah?: number | null;
}

function fmtRupiah(n: number): string {
  return (
    "Rp " +
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(
      n ?? 0,
    )
  );
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

export function buildInvestorStatementEmail(
  input: InvestorStatementEmailInput,
): EmailMessage {
  const roleLabel =
    input.holderType === "investor" ? "Investor" : "Pengelola";
  const subject = `Statement Dividen ${input.periodLabel} — ${input.holderName}`;

  const text = `Halo ${input.holderName},

Statement dividen ${roleLabel} ${input.outletName} untuk periode ${input.periodLabel}:

==========  RINCIAN  ==========
Modal Disetor    : ${fmtRupiah(input.modalDisetor)}
%-Share Pool     : ${input.sharePct.toFixed(4)}%
Dividen Periode  : ${fmtRupiah(input.dividendAmount)}
Tanggal Distribusi: ${fmtDate(input.postedAt)}
${
  input.saldoSebelum != null && input.saldoSesudah != null
    ? `
==========  SALDO  ==========
Saldo Sebelum    : ${fmtRupiah(input.saldoSebelum)}
+ Dividen Period : ${fmtRupiah(input.dividendAmount)}
Saldo Sesudah    : ${fmtRupiah(input.saldoSesudah)}
`
    : ""
}
Dividen akan ditransfer ke rekening bank yang terdaftar.
Kalau ada pertanyaan, hubungi pengelola Mahakan Coffee.

Terima kasih,
${input.outletName}
`;

  const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
  <h2 style="margin:0 0 4px 0;color:#1b5e20">Statement Dividen ${input.periodLabel}</h2>
  <p style="margin:0 0 16px 0;color:#555">
    Halo <b>${input.holderName}</b>, berikut rincian dividen ${roleLabel} kamu di
    <b>${input.outletName}</b>.
  </p>

  <table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px">
    <tr><td style="padding:4px 8px;color:#666">Modal Disetor</td><td style="padding:4px 8px;text-align:right"><b>${fmtRupiah(input.modalDisetor)}</b></td></tr>
    <tr><td style="padding:4px 8px;color:#666">%-Share Pool</td><td style="padding:4px 8px;text-align:right">${input.sharePct.toFixed(4)}%</td></tr>
    <tr><td style="padding:4px 8px;color:#666">Tanggal Distribusi</td><td style="padding:4px 8px;text-align:right">${fmtDate(input.postedAt)}</td></tr>
  </table>

  <div style="margin-top:20px;padding:14px;background:#e8f5e9;border-radius:6px;max-width:520px;text-align:center">
    <div style="color:#2e7d32;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Dividen Periode Ini</div>
    <div style="font-size:30px;font-weight:700;color:#1b5e20">${fmtRupiah(input.dividendAmount)}</div>
  </div>

  ${
    input.saldoSebelum != null && input.saldoSesudah != null
      ? `
  <h3 style="margin:20px 0 6px 0;color:#1b5e20">Akumulasi Saldo</h3>
  <table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px">
    <tr><td style="padding:4px 8px">Saldo Sebelum</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.saldoSebelum)}</td></tr>
    <tr><td style="padding:4px 8px">+ Dividen ${input.periodLabel}</td><td style="padding:4px 8px;text-align:right;color:#2e7d32">${fmtRupiah(input.dividendAmount)}</td></tr>
    <tr style="border-top:1px solid #ccc"><td style="padding:6px 8px"><b>Saldo Sesudah</b></td><td style="padding:6px 8px;text-align:right"><b>${fmtRupiah(input.saldoSesudah)}</b></td></tr>
  </table>
  `
      : ""
  }

  <p style="margin-top:24px;color:#555;font-size:13px">
    Dividen akan ditransfer ke rekening bank yang terdaftar.<br/>
    Kalau ada pertanyaan, hubungi pengelola Mahakan Coffee.<br/><br/>
    Terima kasih,<br/><b>${input.outletName}</b>
  </p>
</body></html>`;

  return {
    to: input.toEmail,
    subject,
    text,
    html,
  };
}
