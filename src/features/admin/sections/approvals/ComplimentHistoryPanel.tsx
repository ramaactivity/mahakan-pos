"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, CalendarRange } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Skeleton,
} from "@/components/ui";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime, toJakartaDateOnly } from "@/lib/date";
import { getRefundVoidComplimentReport } from "@/features/reports/actions";

/**
 * Sesi AE-160 — Riwayat Komplimen panel.
 *
 * Komplimen tidak punya approval gate (input langsung di POS), tapi owner
 * mau visibility di Pusat Persetujuan: siapa kasih komplimen ke siapa,
 * berapa nilainya, alasannya. Pull dari report query yang sama dipakai
 * Laporan/Refund-Void-Komplimen, filter ke kind=compliment, range 30 hari.
 */
export function ComplimentHistoryPanel() {
  const range = useMemo(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    return {
      from: toJakartaDateOnly(from),
      to: toJakartaDateOnly(today),
    };
  }, []);

  const query = useQuery({
    queryKey: ["approvals", "compliment-history", range],
    queryFn: async () => {
      const res = await getRefundVoidComplimentReport(range.from, range.to, [
        "compliment",
      ]);
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const events = useMemo(() => {
    return (query.data?.events ?? []).filter((e) => e.kind === "compliment");
  }, [query.data]);

  const totalAmount = events.reduce(
    (sum, e) => sum + Math.abs(e.amountImpact ?? 0),
    0,
  );
  const totalCogs = events.reduce(
    (sum, e) => sum + Math.abs(e.cogsImpact ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-mahakan-green-900">
              <Heart className="size-5 text-rose-500" />
              Riwayat Komplimen
            </h2>
            <p className="text-xs text-neutral-600">
              Komplimen tidak butuh approval — info-only audit untuk
              monitoring trend. 30 hari terakhir.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700">
            <CalendarRange className="size-3.5" />
            <span>
              {range.from} → {range.to}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
          <div>
            <p className="text-neutral-500">Total Kejadian</p>
            <p className="text-base font-semibold text-neutral-900">
              {events.length}
            </p>
          </div>
          <div>
            <p className="text-neutral-500">Dampak Pendapatan</p>
            <p className="font-mono text-sm font-semibold text-danger-500">
              −{formatRupiah(totalAmount)}
            </p>
          </div>
          <div>
            <p className="text-neutral-500">Dampak COGS</p>
            <p className="font-mono text-sm font-semibold text-warning-700">
              −{formatRupiah(totalCogs)}
            </p>
          </div>
        </div>

        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyCard
            icon={Heart}
            title="Tidak ada komplimen 30 hari terakhir"
            description="Kalau staff kasih komplimen ke customer, kejadiannya akan muncul di sini untuk audit."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Waktu</th>
                  <th className="px-2 py-2 text-left font-medium">No Trx</th>
                  <th className="px-2 py-2 text-left font-medium">Kasir</th>
                  <th className="px-2 py-2 text-left font-medium">Customer</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 text-left font-medium">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {events.map((e) => (
                  <tr key={e.eventId} className="hover:bg-neutral-50">
                    <td className="px-2 py-2 text-xs text-neutral-700">
                      {formatIndonesianDateTime(e.occurredAt)}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-neutral-900">
                      {e.transactionNumber}
                    </td>
                    <td className="px-2 py-2 text-xs text-neutral-700">
                      {e.cashierName ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-xs text-neutral-700">
                      {e.customerName ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-neutral-900">
                      {formatRupiah(Math.abs(e.amountImpact))}
                    </td>
                    <td
                      className="max-w-xs truncate px-2 py-2 text-xs italic text-neutral-600"
                      title={e.reason ?? ""}
                    >
                      {e.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
