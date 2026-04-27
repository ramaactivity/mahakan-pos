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

  y = sectionTitle(doc, "Pengeluaran", y);
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
  y = sectionTitle(doc, "Laba Kotor", y);
  y = row(doc, "Pendapatan − Pengeluaran", formatRupiah(report.grossProfit), y, true);

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
