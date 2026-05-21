"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { fetchAggregatorSettlementDetail } from "@/features/finance/actions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-77 — Drilldown modal untuk 1 settlement aggregator/cashless.
 *
 * Owner/finance klik row di list → buka modal ini → lihat:
 *   - Header info (channel, period, gross/fee/net, ref, bank credited at)
 *   - Per-order line items (kalau ada dari CSV import → table dengan
 *     tanggal, no order, gross, fee, net per order)
 *   - Note + audit info (siapa yang input + kapan)
 *   - Tombol export line items ke CSV (kalau ada)
 *
 * Kalau settlement manual entry (no line items): tampil hint "Tidak ada
 * detail per-order — entry manual atau CSV tidak include detail. Buka
 * source CSV / aggregator app untuk lihat detail."
 */

const CHANNEL_LABEL: Record<string, string> = {
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
  qris: "QRIS",
  edc_bca: "EDC BCA",
};

interface LineItem {
  date: string;
  orderNo?: string | null;
  gross: number;
  fee: number;
  net: number;
  customer?: string | null;
  notes?: string | null;
  rawLine?: number | null;
}

interface AggregatorSettlementDetailModalProps {
  settlementId: string | null;
  open: boolean;
  onClose: () => void;
}

export function AggregatorSettlementDetailModal({
  settlementId,
  open,
  onClose,
}: AggregatorSettlementDetailModalProps) {
  const detailQuery = useQuery({
    queryKey: ["admin", "aggregator-online", "detail", settlementId],
    queryFn: async () => {
      if (!settlementId) return null;
      const res = await fetchAggregatorSettlementDetail({ id: settlementId });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: !!settlementId && open,
    staleTime: 60 * 1000,
  });

  const data = detailQuery.data;
  const lineItems: LineItem[] = Array.isArray(data?.lineItems)
    ? (data.lineItems as LineItem[])
    : [];

  function downloadLineItemsCsv() {
    if (lineItems.length === 0) return;
    const header =
      "tanggal,no_order,customer,gross,fee,net,catatan\n";
    const rows = lineItems
      .map((li) => {
        const cells = [
          li.date,
          li.orderNo ?? "",
          li.customer ?? "",
          String(li.gross),
          String(li.fee),
          String(li.net),
          (li.notes ?? "").replace(/[\n,]/g, " "),
        ];
        return cells
          .map((c) => (c.includes(",") ? `"${c.replace(/"/g, '""')}"` : c))
          .join(",");
      })
      .join("\n");
    const channel = data?.channel ?? "settlement";
    const fname = `${channel}-${data?.periodFrom}-detail.csv`;
    const blob = new Blob(["﻿" + header + rows], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Export ${lineItems.length} order ke CSV`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Detail Settlement"
      description={
        data
          ? `${CHANNEL_LABEL[data.channel] ?? data.channel} · ${data.periodFrom}${data.periodFrom !== data.periodTo ? ` → ${data.periodTo}` : ""}`
          : undefined
      }
      size="3xl"
      footer={
        <>
          {lineItems.length > 0 ? (
            <Button variant="outline" onClick={downloadLineItemsCsv}>
              <FileSpreadsheet className="size-4" aria-hidden /> Export Detail
              CSV
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      {detailQuery.isLoading ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : detailQuery.isError ? (
        <Card className="border-danger-300 bg-danger-50/40 p-3">
          <div className="flex items-start gap-2 text-sm text-danger-700">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            <div>
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : String(detailQuery.error)}
            </div>
          </div>
        </Card>
      ) : !data ? (
        <p className="py-4 text-center text-sm text-neutral-500">
          Settlement tidak ditemukan.
        </p>
      ) : (
        <div className="space-y-4">
          {/* KPI header */}
          <div className="grid grid-cols-3 gap-2">
            <KpiBox label="Gross" value={data.grossAmount} accent="default" />
            <KpiBox label="Fee" value={data.feeAmount} accent="danger" />
            <KpiBox
              label="Net Diterima"
              value={data.netAmount}
              accent="success"
            />
          </div>

          {/* Meta info */}
          <Card>
            <CardContent className="space-y-2 p-3 text-sm">
              {data.referenceNo ? (
                <Row label="Reference No">
                  <span className="font-mono">{data.referenceNo}</span>
                </Row>
              ) : null}
              {data.bankCreditedAt ? (
                <Row label="Bank Credited">
                  {new Date(data.bankCreditedAt)
                    .toISOString()
                    .slice(0, 10)}
                </Row>
              ) : null}
              <Row label="Fee %">
                {data.grossAmount > 0
                  ? `${((data.feeAmount / data.grossAmount) * 100).toFixed(2)}%`
                  : "—"}
              </Row>
              {data.notes ? (
                <Row label="Catatan">
                  <span className="text-neutral-700">{data.notes}</span>
                </Row>
              ) : null}
              <Row label="Dicatat">
                <span className="text-neutral-700">
                  {data.createdByName ?? "—"} ·{" "}
                  {new Date(data.createdAt).toLocaleString("id-ID", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </Row>
            </CardContent>
          </Card>

          {/* Line items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Detail Order
                {lineItems.length > 0 ? (
                  <Badge variant="success" className="ml-2">
                    <FileText className="size-3" aria-hidden /> {lineItems.length}{" "}
                    order
                  </Badge>
                ) : null}
              </h3>
            </div>
            {lineItems.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-4 text-center text-sm text-neutral-500">
                  Tidak ada detail per-order untuk settlement ini.
                  <br />
                  <span className="text-[11px]">
                    Settlement ini di-input manual (tanpa CSV) atau CSV import
                    tidak include detail per-order. Buka source CSV / aggregator
                    app untuk lihat detail.
                  </span>
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left">#</th>
                        <th className="px-2 py-1.5 text-left">Tanggal</th>
                        <th className="px-2 py-1.5 text-left">No Order</th>
                        <th className="px-2 py-1.5 text-left">Customer</th>
                        <th className="px-2 py-1.5 text-right">Gross</th>
                        <th className="px-2 py-1.5 text-right">Fee</th>
                        <th className="px-2 py-1.5 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {lineItems.map((li, idx) => (
                        <tr key={idx} className="hover:bg-neutral-50">
                          <td className="px-2 py-1 text-neutral-400">
                            {idx + 1}
                          </td>
                          <td className="px-2 py-1">{li.date}</td>
                          <td className="px-2 py-1 font-mono">
                            {li.orderNo ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-neutral-700">
                            {li.customer ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {formatRupiah(li.gross)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-danger-600">
                            {li.fee > 0 ? formatRupiah(li.fee) : "—"}
                          </td>
                          <td className="px-2 py-1 text-right font-mono font-semibold text-mahakan-green-700">
                            {formatRupiah(li.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-neutral-50 text-xs font-semibold">
                      <tr>
                        <td colSpan={4} className="px-2 py-1.5 text-right">
                          Total
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {formatRupiah(
                            lineItems.reduce((s, li) => s + li.gross, 0),
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-danger-600">
                          {formatRupiah(
                            lineItems.reduce((s, li) => s + li.fee, 0),
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-mahakan-green-700">
                          {formatRupiah(
                            lineItems.reduce((s, li) => s + li.net, 0),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function KpiBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "default" | "danger" | "success";
}) {
  const accentClass =
    accent === "danger"
      ? "text-danger-600"
      : accent === "success"
        ? "text-mahakan-green-700"
        : "text-neutral-900";
  return (
    <Card className="p-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={cn("mt-0.5 text-base font-bold font-mono", accentClass)}>
        {formatRupiah(value)}
      </p>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/* Suppress unused-import warning. */
void Loader2;
