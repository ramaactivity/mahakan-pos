import "server-only";

import type { EmailMessage } from "../send";

/**
 * Sesi AE-62ad — Payslip email template.
 *
 * Dikirim otomatis ke karyawan setelah Owner menekan "Mark Paid" pada periode
 * payroll. Tujuan: karyawan punya catatan sendiri (PDF/print di HP) tanpa
 * harus minta cetak dari kantor. Mirror tone email approval-code: ringkas,
 * tabel breakdown, no fluff.
 */

export interface PayslipEmailInput {
  toEmail: string;
  employeeName: string;
  outletName: string;
  periodLabel: string; // mis. "April 2026"
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  paidAt: Date;
  /** Breakdown rupiah — semua >= 0. */
  baseSalary: number;
  overtimePay: number;
  bonus: number;
  thr: number;
  lateDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
  grossPay: number;
  netPay: number;
  /** Stats kerja (display only). */
  workDays: number;
  totalWorkMinutes: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  /** Optional note dari Owner untuk line ini. */
  notes: string | null;
}

function fmtRupiah(n: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n ?? 0);
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00+07:00") : d;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function fmtMinutes(mins: number): string {
  if (mins <= 0) return "0 menit";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

export function buildPayslipEmail(input: PayslipEmailInput): EmailMessage {
  const subject = `Slip Gaji ${input.periodLabel} — ${input.employeeName}`;

  const text = `Halo ${input.employeeName},

Berikut slip gaji kamu untuk periode ${input.periodLabel} (${fmtDate(input.periodStart)} – ${fmtDate(input.periodEnd)}) di ${input.outletName}.

Status: DIBAYAR pada ${fmtDate(input.paidAt)}

==========  RINCIAN  ==========
Hari kerja           : ${input.workDays} hari
Total jam kerja      : ${fmtMinutes(input.totalWorkMinutes)}
Total lembur         : ${fmtMinutes(input.totalOvertimeMinutes)}
Total telat          : ${fmtMinutes(input.totalLateMinutes)}

==========  PENERIMAAN  ==========
Gaji pokok           : ${fmtRupiah(input.baseSalary)}
Upah lembur          : ${fmtRupiah(input.overtimePay)}
Bonus                : ${fmtRupiah(input.bonus)}
THR                  : ${fmtRupiah(input.thr)}
                       --------------------
Gross Pay            : ${fmtRupiah(input.grossPay)}

==========  POTONGAN  ==========
Potongan telat       : ${fmtRupiah(input.lateDeduction)}
Potongan kasbon      : ${fmtRupiah(input.advanceDeduction)}
Potongan lain        : ${fmtRupiah(input.otherDeductions)}
                       --------------------
Total Potongan       : ${fmtRupiah(
    input.lateDeduction + input.advanceDeduction + input.otherDeductions,
  )}

==========  TAKE-HOME  ==========
NET PAY              : ${fmtRupiah(input.netPay)}
${input.notes ? `\nCatatan: ${input.notes}\n` : ""}
Kalau ada pertanyaan / koreksi, hubungi HR / Owner.

Terima kasih,
${input.outletName}
`;

  const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
  <h2 style="margin:0 0 4px 0">Slip Gaji ${input.periodLabel}</h2>
  <p style="margin:0 0 16px 0;color:#555">Halo <b>${input.employeeName}</b>, berikut rincian gaji kamu di <b>${input.outletName}</b>.</p>

  <table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px">
    <tr><td style="padding:4px 8px;color:#666">Periode</td><td style="padding:4px 8px"><b>${fmtDate(input.periodStart)} – ${fmtDate(input.periodEnd)}</b></td></tr>
    <tr><td style="padding:4px 8px;color:#666">Dibayar tanggal</td><td style="padding:4px 8px"><b>${fmtDate(input.paidAt)}</b></td></tr>
    <tr><td style="padding:4px 8px;color:#666">Hari kerja</td><td style="padding:4px 8px">${input.workDays} hari (${fmtMinutes(input.totalWorkMinutes)})</td></tr>
    <tr><td style="padding:4px 8px;color:#666">Lembur</td><td style="padding:4px 8px">${fmtMinutes(input.totalOvertimeMinutes)}</td></tr>
    <tr><td style="padding:4px 8px;color:#666">Telat</td><td style="padding:4px 8px">${fmtMinutes(input.totalLateMinutes)}</td></tr>
  </table>

  <h3 style="margin:20px 0 6px 0;color:#2e7d32">Penerimaan</h3>
  <table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px">
    <tr><td style="padding:4px 8px">Gaji pokok</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.baseSalary)}</td></tr>
    <tr><td style="padding:4px 8px">Upah lembur</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.overtimePay)}</td></tr>
    <tr><td style="padding:4px 8px">Bonus</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.bonus)}</td></tr>
    <tr><td style="padding:4px 8px">THR</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.thr)}</td></tr>
    <tr style="border-top:1px solid #ccc"><td style="padding:6px 8px"><b>Gross Pay</b></td><td style="padding:6px 8px;text-align:right"><b>${fmtRupiah(input.grossPay)}</b></td></tr>
  </table>

  <h3 style="margin:16px 0 6px 0;color:#c62828">Potongan</h3>
  <table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px">
    <tr><td style="padding:4px 8px">Potongan telat</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.lateDeduction)}</td></tr>
    <tr><td style="padding:4px 8px">Potongan kasbon</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.advanceDeduction)}</td></tr>
    <tr><td style="padding:4px 8px">Potongan lain</td><td style="padding:4px 8px;text-align:right">${fmtRupiah(input.otherDeductions)}</td></tr>
    <tr style="border-top:1px solid #ccc"><td style="padding:6px 8px"><b>Total Potongan</b></td><td style="padding:6px 8px;text-align:right"><b>${fmtRupiah(
      input.lateDeduction + input.advanceDeduction + input.otherDeductions,
    )}</b></td></tr>
  </table>

  <div style="margin-top:20px;padding:12px;background:#e8f5e9;border-radius:6px;max-width:520px;text-align:center">
    <div style="color:#2e7d32;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Take-home (Net Pay)</div>
    <div style="font-size:28px;font-weight:700;color:#1b5e20">${fmtRupiah(input.netPay)}</div>
  </div>

  ${input.notes ? `<p style="margin-top:16px;padding:8px;background:#fffde7;border-left:3px solid #fbc02d;font-size:13px"><b>Catatan:</b> ${input.notes}</p>` : ""}

  <p style="margin-top:24px;color:#555;font-size:13px">Kalau ada pertanyaan / koreksi, hubungi HR / Owner.<br/>Terima kasih,<br/><b>${input.outletName}</b></p>
</body></html>`;

  return {
    to: input.toEmail,
    subject,
    text,
    html,
  };
}
