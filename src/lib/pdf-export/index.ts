"use client";

import jsPDF from "jspdf";
import { formatRupiah } from "@/lib/format";
import type {
  DailySalesReport,
  PnlReport,
  SalesRangeReport,
} from "@/features/reports";
import type { Outlet } from "@/features/outlets";

type Doc = jsPDF;

const MARGIN = 14; // mm
const BRAND = { primary: "#3D7557", text: "#1F2A24", muted: "#6B7280" };

function brandedHeader(doc: Doc, outlet: Outlet, subtitle: string): number {
  // Brand name + outlet meta block
  doc.setFontSize(16);
  doc.setTextColor(BRAND.primary);
  doc.setFont("helvetica", "bold");
  doc.text(outlet.name, MARGIN, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND.muted);
  let y = 24;
  if (outlet.address) {
    doc.text(outlet.address, MARGIN, y);
    y += 4;
  }
  if (outlet.phone) {
    doc.text(`Telp: ${outlet.phone}`, MARGIN, y);
    y += 4;
  }

  // Right-aligned title
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(BRAND.text);
  const pageW = doc.internal.pageSize.getWidth();
  doc.text(subtitle, pageW - MARGIN, 18, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(BRAND.muted);
  doc.text(
    `Dicetak: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
    pageW - MARGIN,
    23,
    { align: "right" },
  );

  // Brand line
  doc.setDrawColor(BRAND.primary);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + 2, pageW - MARGIN, y + 2);

  return y + 8;
}

function sectionTitle(doc: Doc, label: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(BRAND.text);
  doc.text(label, MARGIN, y);
  return y + 5;
}

function row(
  doc: Doc,
  left: string,
  right: string,
  y: number,
  bold = false,
): number {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(10);
  doc.setTextColor(BRAND.text);
  const pageW = doc.internal.pageSize.getWidth();
  doc.text(left, MARGIN, y);
  doc.text(right, pageW - MARGIN, y, { align: "right" });
  return y + 5;
}

function divider(doc: Doc, y: number): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor("#E5E3DB");
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 4;
}

function ensurePage(doc: Doc, y: number, needed = 30): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 12) {
    doc.addPage();
    return 18;
  }
  return y;
}

function footer(doc: Doc) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(BRAND.muted);
    doc.text(
      `Halaman ${i} dari ${total}`,
      pageW / 2,
      pageH - 6,
      { align: "center" },
    );
  }
}

function save(doc: Doc, filename: string) {
  doc.save(filename);
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card_bca: "Kartu BCA",
};

export function exportDailySalesPdf(
  report: DailySalesReport,
  outlet: Outlet,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(doc, outlet, `Laporan Penjualan Harian — ${report.date}`);

  y = sectionTitle(doc, "Ringkasan", y);
  y = row(doc, "Total Revenue", formatRupiah(report.metrics.revenue), y, true);
  y = row(
    doc,
    "Jumlah Transaksi",
    `${report.metrics.transactionCount}`,
    y,
  );
  y = row(
    doc,
    "Rata-rata per Transaksi",
    formatRupiah(report.metrics.averageTicket),
    y,
  );
  y = row(
    doc,
    "Voided",
    `${report.metrics.voidedCount} (${formatRupiah(report.metrics.voidedAmount)})`,
    y,
  );
  y = row(
    doc,
    "Refunded",
    `${report.metrics.refundedCount} (${formatRupiah(report.metrics.refundedAmount)})`,
    y,
  );
  y = divider(doc, y);

  y = sectionTitle(doc, "Per Metode Pembayaran", y);
  for (const m of report.byPaymentMethod) {
    y = row(
      doc,
      `${PAYMENT_LABEL[m.method] ?? m.method} (${m.count} trx)`,
      formatRupiah(m.amount),
      y,
    );
  }
  y = divider(doc, y);

  if (report.byCategory.length > 0) {
    y = ensurePage(doc, y, 50);
    y = sectionTitle(doc, "Per Kategori", y);
    for (const c of report.byCategory) {
      y = ensurePage(doc, y);
      y = row(doc, `${c.categoryName} (${c.count}×)`, formatRupiah(c.revenue), y);
    }
    y = divider(doc, y);
  }

  if (report.topItems.length > 0) {
    y = ensurePage(doc, y, 50);
    y = sectionTitle(doc, "Top 10 Item", y);
    for (const [idx, item] of report.topItems.entries()) {
      y = ensurePage(doc, y);
      y = row(
        doc,
        `${idx + 1}. ${item.name} (${item.quantity}×)`,
        formatRupiah(item.revenue),
        y,
      );
    }
  }

  footer(doc);
  save(doc, `mahakan-sales-${report.date}.pdf`);
}

export function exportPnlPdf(report: PnlReport, outlet: Outlet): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Laporan P&L — ${report.period.from} s/d ${report.period.to}`,
  );

  y = sectionTitle(doc, "Pendapatan", y);
  y = row(doc, "Penjualan POS", formatRupiah(report.income.posRevenue), y);
  y = row(doc, "Pemasukan manual", formatRupiah(report.income.manualIncome), y);
  y = row(doc, "Total Pendapatan", formatRupiah(report.income.total), y, true);
  y = divider(doc, y);

  y = sectionTitle(doc, "HPP (Cost of Goods Sold)", y);
  y = row(doc, "Total HPP (snapshot)", formatRupiah(report.cogs), y, true);
  y = divider(doc, y);

  y = sectionTitle(doc, "Laba Kotor (Gross Margin)", y);
  y = row(
    doc,
    "Pendapatan − HPP",
    formatRupiah(report.grossMargin),
    y,
    true,
  );
  y = divider(doc, y);

  y = sectionTitle(doc, "Pengeluaran Operasional", y);
  if (report.expenses.byCategory.length === 0) {
    y = row(doc, "Tidak ada pengeluaran", "—", y);
  } else {
    for (const e of report.expenses.byCategory) {
      y = ensurePage(doc, y);
      y = row(doc, e.name, formatRupiah(e.amount), y);
    }
  }
  y = row(doc, "Total Pengeluaran", formatRupiah(report.expenses.total), y, true);
  y = divider(doc, y);

  y = ensurePage(doc, y);
  y = sectionTitle(doc, "Laba Bersih", y);
  y = row(
    doc,
    "Gross Margin − Pengeluaran",
    formatRupiah(report.netProfit),
    y,
    true,
  );

  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(BRAND.muted);
  const pageW = doc.internal.pageSize.getWidth();
  const lines = doc.splitTextToSize(report.disclaimer, pageW - MARGIN * 2);
  doc.text(lines, MARGIN, y);

  footer(doc);
  save(doc, `mahakan-pnl-${report.period.from}_${report.period.to}.pdf`);
}

export function exportSalesRangePdf(
  report: SalesRangeReport,
  outlet: Outlet,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Laporan Periode — ${report.period.from} s/d ${report.period.to}`,
  );

  y = sectionTitle(doc, "Ringkasan Periode", y);
  y = row(doc, "Revenue", formatRupiah(report.metrics.revenue), y, true);
  y = row(
    doc,
    "Transaksi",
    `${report.metrics.transactionCount}`,
    y,
  );
  y = row(
    doc,
    "Avg per Trx",
    formatRupiah(report.metrics.averageTicket),
    y,
  );
  y = divider(doc, y);

  y = sectionTitle(doc, "Vs Periode Sebelumnya", y);
  doc.setFontSize(9);
  doc.setTextColor(BRAND.muted);
  doc.text(
    `(${report.comparison.period.from} s/d ${report.comparison.period.to})`,
    MARGIN,
    y,
  );
  y += 5;
  const pct = (n: number | null) =>
    n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`;
  y = row(
    doc,
    "Revenue",
    `${formatRupiah(report.comparison.revenue)} → ${pct(report.comparison.revenueChangePct)}`,
    y,
  );
  y = row(
    doc,
    "Transaksi",
    `${report.comparison.transactionCount} → ${pct(report.comparison.transactionCountChangePct)}`,
    y,
  );
  y = divider(doc, y);

  if (report.byCategory.length > 0) {
    y = ensurePage(doc, y, 50);
    y = sectionTitle(doc, "Per Kategori", y);
    for (const c of report.byCategory) {
      y = ensurePage(doc, y);
      y = row(doc, `${c.categoryName} (${c.count}×)`, formatRupiah(c.revenue), y);
    }
    y = divider(doc, y);
  }

  if (report.topItems.length > 0) {
    y = ensurePage(doc, y, 50);
    y = sectionTitle(doc, "Top Item", y);
    for (const [idx, item] of report.topItems.entries()) {
      y = ensurePage(doc, y);
      y = row(
        doc,
        `${idx + 1}. ${item.name} (${item.quantity}×)`,
        formatRupiah(item.revenue),
        y,
      );
    }
  }

  footer(doc);
  save(
    doc,
    `mahakan-range-${report.period.from}_${report.period.to}.pdf`,
  );
}

// ============================================================================
// Sesi Y — Accounting reports PDF (TB / IS / BS)
// ============================================================================

import type {
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
} from "@/features/accounting/reports";

export function exportTrialBalancePdf(
  report: TrialBalanceReport,
  outlet: Outlet,
  range: { from: string; to: string },
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Trial Balance — ${range.from} s/d ${range.to}`,
  );

  // Table header
  const pageW = doc.internal.pageSize.getWidth();
  const colCode = MARGIN;
  const colName = MARGIN + 18;
  const colDebit = pageW - MARGIN - 50;
  const colCredit = pageW - MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(BRAND.muted);
  doc.text("Kode", colCode, y);
  doc.text("Akun", colName, y);
  doc.text("Debit", colDebit, y, { align: "right" });
  doc.text("Credit", colCredit, y, { align: "right" });
  y += 4;
  y = divider(doc, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND.text);
  for (const r of report.rows) {
    y = ensurePage(doc, y);
    doc.text(r.code, colCode, y);
    const nameLines = doc.splitTextToSize(r.name, colDebit - colName - 2);
    doc.text(nameLines[0] ?? r.name, colName, y);
    doc.text(
      r.debit > 0 ? formatRupiah(r.debit) : "—",
      colDebit,
      y,
      { align: "right" },
    );
    doc.text(
      r.credit > 0 ? formatRupiah(r.credit) : "—",
      colCredit,
      y,
      { align: "right" },
    );
    y += 4.5;
  }

  y += 1;
  y = divider(doc, y);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL", colName, y);
  doc.text(formatRupiah(report.totalDebit), colDebit, y, { align: "right" });
  doc.text(formatRupiah(report.totalCredit), colCredit, y, { align: "right" });
  y += 5;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(report.balanced ? "#2E7D5B" : "#C0392B");
  doc.text(
    report.balanced
      ? "✓ Balanced — total debit = total credit"
      : `✕ TIDAK BALANCE — selisih ${formatRupiah(Math.abs(report.totalDebit - report.totalCredit))}`,
    MARGIN,
    y,
  );

  footer(doc);
  save(doc, `mahakan-trial-balance-${range.from}_${range.to}.pdf`);
}

export function exportIncomeStatementPdf(
  report: IncomeStatementReport,
  outlet: Outlet,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Laporan Laba Rugi — ${report.periodLabel}`,
  );

  // Pendapatan
  y = sectionTitle(doc, "PENDAPATAN", y);
  for (const item of report.revenue.items) {
    y = ensurePage(doc, y);
    y = row(doc, `  ${item.code} ${item.name}`, formatRupiah(item.amount), y);
  }
  y = row(doc, "Subtotal Pendapatan", formatRupiah(report.revenue.subtotal), y, true);

  if (report.revenueContra.items.length > 0) {
    y += 2;
    for (const item of report.revenueContra.items) {
      y = ensurePage(doc, y);
      y = row(
        doc,
        `  ${item.code} ${item.name}`,
        `(${formatRupiah(item.amount)})`,
        y,
      );
    }
    y = row(
      doc,
      "Subtotal Diskon + Refund",
      `(${formatRupiah(report.revenueContra.subtotal)})`,
      y,
      true,
    );
  }
  y = divider(doc, y);
  y = row(doc, "PENDAPATAN BERSIH", formatRupiah(report.netRevenue), y, true);
  y = divider(doc, y);

  // HPP
  y = ensurePage(doc, y);
  y = sectionTitle(doc, "HARGA POKOK PENJUALAN", y);
  for (const item of report.cogs.items) {
    y = ensurePage(doc, y);
    y = row(
      doc,
      `  ${item.code} ${item.name}`,
      `(${formatRupiah(item.amount)})`,
      y,
    );
  }
  y = row(
    doc,
    "Subtotal HPP",
    `(${formatRupiah(report.cogs.subtotal)})`,
    y,
    true,
  );
  y = divider(doc, y);
  y = row(doc, "LABA KOTOR", formatRupiah(report.grossProfit), y, true);
  y = divider(doc, y);

  // Beban Operasional
  y = ensurePage(doc, y);
  y = sectionTitle(doc, "BEBAN OPERASIONAL", y);
  for (const item of report.expenses.items) {
    y = ensurePage(doc, y);
    y = row(
      doc,
      `  ${item.code} ${item.name}`,
      `(${formatRupiah(item.amount)})`,
      y,
    );
  }
  y = row(
    doc,
    "Subtotal Beban",
    `(${formatRupiah(report.expenses.subtotal)})`,
    y,
    true,
  );
  y = divider(doc, y);

  y = ensurePage(doc, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(report.netIncome >= 0 ? BRAND.primary : "#C0392B");
  const pageW = doc.internal.pageSize.getWidth();
  doc.text("LABA / RUGI BERSIH", MARGIN, y);
  doc.text(
    `${report.netIncome < 0 ? "(" : ""}${formatRupiah(Math.abs(report.netIncome))}${report.netIncome < 0 ? ")" : ""}`,
    pageW - MARGIN,
    y,
    { align: "right" },
  );

  footer(doc);
  save(doc, `mahakan-laba-rugi-${report.periodLabel.replace(/\s/g, "-")}.pdf`);
}

export function exportBalanceSheetPdf(
  report: BalanceSheetReport,
  outlet: Outlet,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Neraca — Per ${report.asOfDate}`,
  );

  // ASET
  y = sectionTitle(doc, "ASET", y);
  for (const a of report.assets) {
    y = ensurePage(doc, y);
    y = row(
      doc,
      `  ${a.code} ${a.isContra ? "(-) " : ""}${a.name}`,
      formatRupiah(a.amount),
      y,
    );
  }
  y = divider(doc, y);
  y = row(doc, "TOTAL ASET", formatRupiah(report.totalAssets), y, true);
  y = divider(doc, y);

  // KEWAJIBAN
  y = ensurePage(doc, y);
  y = sectionTitle(doc, "KEWAJIBAN", y);
  if (report.liabilities.length === 0) {
    y = row(doc, "  Tidak ada kewajiban", "—", y);
  } else {
    for (const l of report.liabilities) {
      y = ensurePage(doc, y);
      y = row(doc, `  ${l.code} ${l.name}`, formatRupiah(l.amount), y);
    }
  }
  y = row(
    doc,
    "Subtotal Kewajiban",
    formatRupiah(report.totalLiabilities),
    y,
    true,
  );
  y = divider(doc, y);

  // EKUITAS
  y = ensurePage(doc, y);
  y = sectionTitle(doc, "EKUITAS", y);
  for (const e of report.equity) {
    y = ensurePage(doc, y);
    y = row(
      doc,
      `  ${e.code} ${e.isContra ? "(-) " : ""}${e.name}`,
      formatRupiah(e.amount),
      y,
    );
  }
  y = row(doc, "Subtotal Ekuitas", formatRupiah(report.totalEquity), y, true);
  y = divider(doc, y);

  y = ensurePage(doc, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(BRAND.text);
  const pageW = doc.internal.pageSize.getWidth();
  doc.text("TOTAL KEWAJIBAN + EKUITAS", MARGIN, y);
  doc.text(
    formatRupiah(report.totalLiabilities + report.totalEquity),
    pageW - MARGIN,
    y,
    { align: "right" },
  );
  y += 5;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(report.balanced ? "#2E7D5B" : "#C0392B");
  doc.text(
    report.balanced
      ? "✓ Balanced — Total Aset = Total Kewajiban + Ekuitas"
      : `✕ Tidak balance — selisih ${formatRupiah(Math.abs(report.totalAssets - (report.totalLiabilities + report.totalEquity)))}`,
    MARGIN,
    y,
  );

  footer(doc);
  save(doc, `mahakan-neraca-${report.asOfDate}.pdf`);
}

import type { CashFlowStatement } from "@/features/accounting/reports";

export function exportCashFlowStatementPdf(
  report: CashFlowStatement,
  outlet: Outlet,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = brandedHeader(
    doc,
    outlet,
    `Laporan Arus Kas — ${report.periodLabel}`,
  );

  y = row(doc, "Saldo Kas Awal", formatRupiah(report.openingCash), y, true);
  y = divider(doc, y);

  // Operating
  y = sectionTitle(doc, report.operating.label, y);
  for (const item of report.operating.items) {
    y = ensurePage(doc, y);
    y = row(
      doc,
      `  ${item.label} (${item.entryCount}×)`,
      `${item.amount < 0 ? "(" : ""}${formatRupiah(Math.abs(item.amount))}${item.amount < 0 ? ")" : ""}`,
      y,
    );
  }
  y = row(
    doc,
    "Net Operating",
    `${report.operating.netCash < 0 ? "(" : ""}${formatRupiah(Math.abs(report.operating.netCash))}${report.operating.netCash < 0 ? ")" : ""}`,
    y,
    true,
  );
  y = divider(doc, y);

  // Investing
  y = ensurePage(doc, y);
  y = sectionTitle(doc, report.investing.label, y);
  if (report.investing.items.length === 0) {
    y = row(doc, "  (tidak ada aktivitas investasi)", "—", y);
  } else {
    for (const item of report.investing.items) {
      y = ensurePage(doc, y);
      y = row(
        doc,
        `  ${item.label} (${item.entryCount}×)`,
        `${item.amount < 0 ? "(" : ""}${formatRupiah(Math.abs(item.amount))}${item.amount < 0 ? ")" : ""}`,
        y,
      );
    }
  }
  y = row(
    doc,
    "Net Investing",
    `${report.investing.netCash < 0 ? "(" : ""}${formatRupiah(Math.abs(report.investing.netCash))}${report.investing.netCash < 0 ? ")" : ""}`,
    y,
    true,
  );
  y = divider(doc, y);

  // Financing
  y = ensurePage(doc, y);
  y = sectionTitle(doc, report.financing.label, y);
  if (report.financing.items.length === 0) {
    y = row(doc, "  (tidak ada aktivitas pendanaan)", "—", y);
  } else {
    for (const item of report.financing.items) {
      y = ensurePage(doc, y);
      y = row(
        doc,
        `  ${item.label} (${item.entryCount}×)`,
        `${item.amount < 0 ? "(" : ""}${formatRupiah(Math.abs(item.amount))}${item.amount < 0 ? ")" : ""}`,
        y,
      );
    }
  }
  y = row(
    doc,
    "Net Financing",
    `${report.financing.netCash < 0 ? "(" : ""}${formatRupiah(Math.abs(report.financing.netCash))}${report.financing.netCash < 0 ? ")" : ""}`,
    y,
    true,
  );
  y = divider(doc, y);

  // Summary
  y = ensurePage(doc, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(BRAND.text);
  const pageW = doc.internal.pageSize.getWidth();
  doc.text("Perubahan Bersih Kas", MARGIN, y);
  doc.text(
    `${report.netChangeInCash < 0 ? "(" : ""}${formatRupiah(Math.abs(report.netChangeInCash))}${report.netChangeInCash < 0 ? ")" : ""}`,
    pageW - MARGIN,
    y,
    { align: "right" },
  );
  y += 5;
  doc.text("Saldo Kas Akhir (Computed)", MARGIN, y);
  doc.text(formatRupiah(report.closingCashComputed), pageW - MARGIN, y, {
    align: "right",
  });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND.muted);
  doc.text("Saldo Kas Akhir (Aktual)", MARGIN, y);
  doc.text(formatRupiah(report.closingCashActual), pageW - MARGIN, y, {
    align: "right",
  });
  y += 5;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(report.matchesActualClosing ? "#2E7D5B" : "#C0392B");
  doc.text(
    report.matchesActualClosing
      ? "✓ Computed match aktual saldo kas — data integrity OK"
      : `✕ Tidak match — selisih ${formatRupiah(Math.abs(report.closingCashComputed - report.closingCashActual))}`,
    MARGIN,
    y,
  );

  footer(doc);
  save(
    doc,
    `mahakan-arus-kas-${report.periodLabel.replace(/\s/g, "-")}.pdf`,
  );
}
