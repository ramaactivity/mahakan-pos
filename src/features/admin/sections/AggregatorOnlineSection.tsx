"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Bike,
  CreditCard,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Plus,
  QrCode,
  Settings2,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DatePicker,
  DateRangePicker,
  EmptyCard,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { fetchAccounts } from "@/features/accounting/actions";
import {
  defaultBankCodeForChannel,
  SETTLEMENT_CHANNEL_LABEL,
  SETTLEMENT_CHANNELS,
  type AggregatorChannel as SettlementChannel,
} from "@/features/accounting/mapping/aggregatorSettlement";
import {
  postSettlementBankReclass,
  previewSettlementBankReclass,
  type SettlementReclassPreview,
} from "@/features/finance/settlement-reclass-actions";
import {
  fetchAggregatorSettlements,
  generateCashlessSettlementFromPos,
  getCashlessMdrConfig,
  updateCashlessMdrConfig,
} from "@/features/finance/actions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseRupiah } from "@/lib/format";
import {
  getSettlementRevisionContext,
  listSettlementRevisions,
  postSettlementRevision,
  detectChannelRoutingDrift,
  repostSettlementJournal,
  reverseSettlementRevision,
  type ChannelRoutingDrift,
  type SettlementRevisionContext,
} from "@/features/finance/settlement-revision-actions";
import type { AccountListRow } from "@/features/accounting/types";

/** Sesi AE-77 — Short rupiah format for axis ticks & compact KPI subtitle. */
function formatRupiahShort(n: number): string {
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}rb`;
  return formatRupiah(n);
}
import { AggregatorSettlementDetailModal } from "./aggregator-online/AggregatorSettlementDetailModal";
import { AggregatorImportWizardModal } from "./aggregator-online/AggregatorImportWizardModal";
import { addDaysJakarta, jakartaDateOf, todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-77 — Laporan Online Order (GoFood / GrabFood / ShopeeFood / QRIS / EDC).
 *
 * Halaman dedicated untuk finance + akuntansi yang butuh visibility detail
 * settlement per channel online. Replace partial coverage di ReconciliationView
 * (yang cuma tabel sederhana tanpa drilldown / chart / filter per channel).
 *
 * Layout:
 *   - Header (judul + tombol Import CSV + tombol Manual Entry)
 *   - Date range filter (default 30 hari terakhir)
 *   - Tab: Ringkasan / GoFood / GrabFood / ShopeeFood / QRIS / EDC BCA
 *   - Per tab:
 *       - KPI cards (Gross, Fee, Net, % Fee)
 *       - Trend chart bar (gross/fee/net per period)
 *       - List settlements (click row → drilldown modal)
 *   - Ringkasan: combined KPI + per-channel comparison
 *
 * Drilldown modal: header info + line items (kalau ada dari CSV import) +
 * link ke journal entry yang ter-post (auto-journal hook). Finance bisa
 * trace per-order tanpa harus buka CSV file aslinya.
 */

type AggregatorChannel =
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "qris"
  | "edc_bca";
type TabKey = "summary" | AggregatorChannel;

const CHANNEL_META: Record<
  AggregatorChannel,
  { label: string; Icon: typeof Bike; accent: string; bgAccent: string }
> = {
  gofood: {
    label: "GoFood",
    Icon: Bike,
    accent: "text-success-700",
    bgAccent: "bg-success-50",
  },
  grabfood: {
    label: "GrabFood",
    Icon: ShoppingBag,
    accent: "text-success-600",
    bgAccent: "bg-success-50",
  },
  shopeefood: {
    label: "ShopeeFood",
    Icon: ShoppingBag,
    accent: "text-warning-700",
    bgAccent: "bg-warning-50",
  },
  qris: {
    label: "QRIS",
    Icon: QrCode,
    accent: "text-mahakan-green-700",
    bgAccent: "bg-mahakan-green-50",
  },
  edc_bca: {
    label: "EDC BCA",
    Icon: CreditCard,
    accent: "text-info-700",
    bgAccent: "bg-info-50",
  },
};

const TABS: Array<{ key: TabKey; label: string; Icon: typeof Bike }> = [
  { key: "summary", label: "Ringkasan", Icon: TrendingUp },
  { key: "gofood", label: "GoFood", Icon: Bike },
  { key: "grabfood", label: "GrabFood", Icon: ShoppingBag },
  { key: "shopeefood", label: "ShopeeFood", Icon: ShoppingBag },
  { key: "qris", label: "QRIS", Icon: QrCode },
  { key: "edc_bca", label: "EDC BCA", Icon: CreditCard },
];

/* Sesi AE-191 — rentang default ikut kalender WIB, bukan UTC. */
function defaultRange(): { from: string; to: string } {
  const today = todayJakarta();
  return { from: addDaysJakarta(today, -30), to: today };
}

export function AggregatorOnlineSection() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("summary");
  const [range, setRange] = useState<{ from: string; to: string }>(
    defaultRange(),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  /* Sesi AE-246 — revisi settlement per hari. */
  const [reviseId, setReviseId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  /* Sesi AE-165 — auto-generate QRIS/EDC dari POS + config MDR. */
  const [generating, setGenerating] = useState(false);
  const [mdrOpen, setMdrOpen] = useState(false);
  /* Sesi AE-219 — alat pindah rekening jurnal settlement. */
  const [reclassOpen, setReclassOpen] = useState(false);

  async function onGenerateFromPos() {
    if (generating) return;
    setGenerating(true);
    const res = await generateCashlessSettlementFromPos({
      from: range.from,
      to: range.to,
    });
    setGenerating(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    const n = res.data.created.length;
    if (n === 0) {
      toast.success(
        "Tidak ada settlement baru — semua hari di periode ini sudah ter-cover (atau belum ada transaksi QRIS/EDC).",
      );
    } else {
      toast.success(`${n} settlement QRIS/EDC dibuat dari POS 🎉`);
    }
    void queryClient.invalidateQueries({
      queryKey: ["admin", "aggregator-online"],
    });
  }

  const listQuery = useQuery({
    queryKey: ["admin", "aggregator-online", range.from, range.to],
    queryFn: async () => {
      const res = await fetchAggregatorSettlements({
        channel: "all",
        fromDate: range.from,
        toDate: range.to,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const allRows = listQuery.data ?? [];
  const channelRows = useMemo(() => {
    if (tab === "summary") return allRows;
    return allRows.filter((r) => r.channel === tab);
  }, [allRows, tab]);

  /* Sesi AE-246 — revisi yang masih berlaku untuk baris yang sedang tampil,
   * ditarik SEKALI untuk seluruh daftar (bukan per baris). */
  const visibleIds = useMemo(
    () => channelRows.map((r) => r.id),
    [channelRows],
  );
  const revisionsQ = useQuery({
    queryKey: ["settlement-revisions", visibleIds],
    queryFn: async () => {
      const res = await listSettlementRevisions(visibleIds);
      return res.ok ? res.data : [];
    },
    enabled: visibleIds.length > 0,
    staleTime: 60 * 1000,
  });
  /* Sesi AE-255 — pengaturan rekening yang sudah basi. Ditaruh di layar ini
   * karena di sinilah owner merevisi settlement satu per satu; tanpa
   * peringatannya, dia akan terus merevisi tanpa pernah tahu pengaturannya
   * yang perlu diubah. */
  const driftQ = useQuery({
    queryKey: ["settlement-routing-drift"],
    queryFn: async () => {
      const res = await detectChannelRoutingDrift();
      return res.ok ? res.data : ([] as ChannelRoutingDrift[]);
    },
    staleTime: 5 * 60 * 1000,
  });

  const revisionBySettlement = useMemo(() => {
    const m = new Map<string, true>();
    for (const r of revisionsQ.data ?? []) {
      if (r.status === "posted") m.set(r.settlementId, true);
    }
    return m;
  }, [revisionsQ.data]);

  const totals = useMemo(() => {
    let gross = 0;
    let fee = 0;
    let net = 0;
    for (const r of channelRows) {
      gross += r.grossAmount;
      fee += r.feeAmount;
      net += r.netAmount;
    }
    const feePct = gross > 0 ? (fee / gross) * 100 : 0;
    return { gross, fee, net, feePct, count: channelRows.length };
  }, [channelRows]);

  // Per-channel breakdown for ringkasan
  const perChannel = useMemo(() => {
    const result: Record<
      AggregatorChannel,
      { gross: number; fee: number; net: number; count: number }
    > = {
      gofood: { gross: 0, fee: 0, net: 0, count: 0 },
      grabfood: { gross: 0, fee: 0, net: 0, count: 0 },
      shopeefood: { gross: 0, fee: 0, net: 0, count: 0 },
      qris: { gross: 0, fee: 0, net: 0, count: 0 },
      edc_bca: { gross: 0, fee: 0, net: 0, count: 0 },
    };
    for (const r of allRows) {
      const c = r.channel as AggregatorChannel;
      if (!result[c]) continue;
      result[c].gross += r.grossAmount;
      result[c].fee += r.feeAmount;
      result[c].net += r.netAmount;
      result[c].count += 1;
    }
    return result;
  }, [allRows]);

  // Trend data: gross per period (date), grouped by channel for summary, flat per current channel
  const trendData = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; gross: number; fee: number; net: number }
    >();
    for (const r of channelRows) {
      const cur = byDate.get(r.periodFrom) ?? {
        date: r.periodFrom,
        gross: 0,
        fee: 0,
        net: 0,
      };
      cur.gross += r.grossAmount;
      cur.fee += r.feeAmount;
      cur.net += r.netAmount;
      byDate.set(r.periodFrom, cur);
    }
    return Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [channelRows]);

  function onDetailClose() {
    setDetailId(null);
  }
  function onWizardSaved() {
    setWizardOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["admin", "aggregator-online"] });
  }

  return (
    <div className="space-y-4 p-6">
      {(driftQ.data ?? []).length > 0 ? (
        <div className="rounded-lg border border-warning-500/50 bg-warning-100/40 p-3 text-xs">
          <p className="font-medium text-neutral-900">
            Pengaturan rekening sepertinya sudah tidak sesuai
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {(driftQ.data ?? []).map((d) => (
              <li key={d.channel} className="leading-relaxed text-neutral-700">
                <b>{d.channelLabel}</b> — {d.streak} revisi terakhir
                berturut-turut mendarat di <b>{d.actualCode}</b> (sejak{" "}
                {d.since}), tapi settlement baru masih dijurnal ke{" "}
                <b>{d.currentCode}</b>. Selama ini belum diubah, tiap
                settlement baru akan salah rekening dan harus direvisi lagi.
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setMdrOpen(true)}
          >
            <Settings2 className="size-4" aria-hidden /> Perbarui di MDR &amp;
            Rekening
          </Button>
        </div>
      ) : null}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Laporan Online & Cashless
          </h1>
          <p className="mt-0.5 max-w-3xl text-sm text-neutral-700">
            Aggregator (GoFood/GrabFood/ShopeeFood) lewat Import CSV. QRIS &
            EDC BCA otomatis dari POS — klik <b>Generate dari POS</b> (atau
            jalan otomatis tiap hari). CSV jadi opsional buat cocokin bank.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMdrOpen(true)}
            aria-label="Atur MDR & rekening tujuan"
          >
            <Settings2 className="size-4" aria-hidden /> MDR &amp; Rekening
          </Button>
          {/* Sesi AE-219 — perbaiki jurnal settlement yang terlanjur mendarat
              di rekening yang salah (QRIS Mahakan cair ke BNI, jurnalnya
              mendebit BCA). */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReclassOpen(true)}
            aria-label="Pindah rekening jurnal settlement"
          >
            <ArrowLeftRight className="size-4" aria-hidden /> Pindah Rekening
          </Button>
          <Button size="sm" onClick={onGenerateFromPos} disabled={generating}>
            {generating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            Generate dari POS
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
            <Upload className="size-4" aria-hidden /> Import CSV
          </Button>
        </div>
      </div>

      {/* Date range filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[260px]">
            <label className="block text-xs font-medium text-neutral-700">
              Periode
            </label>
            <DateRangePicker
              value={range}
              onChange={(v) =>
                setRange({
                  from: v.from ?? defaultRange().from,
                  to: v.to ?? defaultRange().to,
                })
              }
            />
          </div>
          <div className="text-xs text-neutral-500">
            {listQuery.isLoading
              ? "Memuat…"
              : `${allRows.length} settlement dalam periode ini`}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Channel"
        className="flex gap-1 overflow-x-auto border-b border-neutral-200"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          const Icon = t.Icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                active
                  ? "border-mahakan-green-700 text-mahakan-green-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {listQuery.isError ? (
        <Card className="border-danger-300 bg-danger-50/40 p-4">
          <div className="flex items-start gap-2 text-sm text-danger-700">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            <div>
              <strong>Gagal memuat data:</strong>{" "}
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : String(listQuery.error)}
            </div>
          </div>
        </Card>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Gross"
          value={formatRupiah(totals.gross)}
          loading={listQuery.isLoading}
          accent="default"
        />
        <KpiCard
          label="Fee Total"
          value={formatRupiah(totals.fee)}
          sub={`${totals.feePct.toFixed(1)}% dari gross`}
          loading={listQuery.isLoading}
          accent="danger"
          Icon={TrendingDown}
        />
        <KpiCard
          label="Net Diterima"
          value={formatRupiah(totals.net)}
          loading={listQuery.isLoading}
          accent="success"
          Icon={TrendingUp}
        />
        <KpiCard
          label="Jumlah Settlement"
          value={totals.count.toString()}
          sub="batch / period entries"
          loading={listQuery.isLoading}
        />
      </div>

      {/* Per-channel comparison cards (ringkasan only) */}
      {tab === "summary" ? (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              Per Channel
            </h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
              {(Object.keys(CHANNEL_META) as AggregatorChannel[]).map((c) => {
                const meta = CHANNEL_META[c];
                const Icon = meta.Icon;
                const stats = perChannel[c];
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTab(c)}
                    className={cn(
                      "flex flex-col items-start gap-1.5 rounded-md border border-neutral-200 p-3 text-left transition-colors",
                      "hover:border-mahakan-green-500/60 hover:bg-mahakan-green-50/30",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md",
                          meta.bgAccent,
                          meta.accent,
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </div>
                      <span className="text-sm font-semibold text-neutral-900">
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-base font-bold text-neutral-900">
                      {formatRupiahShort(stats.net)}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      Gross {formatRupiahShort(stats.gross)} ·{" "}
                      {stats.count} batch
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Trend chart */}
      {trendData.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Trend per Periode
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-neutral-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-mahakan-green-700" />
                  Net
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-danger-400" />
                  Fee
                </span>
              </div>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#514E45" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#514E45" }}
                    tickFormatter={formatRupiahShort}
                  />
                  <Tooltip
                    formatter={(v) =>
                      typeof v === "number" ? formatRupiah(v) : String(v)
                    }
                    labelStyle={{ color: "#514E45" }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #E5E3DB",
                    }}
                  />
                  <Bar dataKey="net" fill="#3D7557" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="fee" fill="#F1A8A8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* List */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              {tab === "summary"
                ? "Semua Settlement"
                : `Settlement ${CHANNEL_META[tab].label}`}{" "}
              <span className="ml-1 text-xs font-normal text-neutral-500">
                ({channelRows.length})
              </span>
            </h2>
          </div>
          {listQuery.isLoading ? (
            <div className="space-y-1 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : channelRows.length === 0 ? (
            <EmptyCard
              icon={Inbox}
              title="Belum ada settlement di periode ini"
              description={
                tab === "summary"
                  ? "Tidak ada catatan settlement aggregator/cashless dalam range tanggal yang dipilih. Coba ganti periode atau import CSV."
                  : `Belum ada settlement ${CHANNEL_META[tab].label} dalam periode ini.`
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    {tab === "summary" ? (
                      <th className="px-3 py-2 text-left">Channel</th>
                    ) : null}
                    <th className="px-3 py-2 text-left">Periode</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Fee</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-left">Ref / Note</th>
                    <th className="px-3 py-2 text-left">Order</th>
                    <th className="px-3 py-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {channelRows.map((r) => {
                    const meta =
                      CHANNEL_META[r.channel as AggregatorChannel] ?? null;
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-mahakan-green-50/30"
                        onClick={() => setDetailId(r.id)}
                      >
                        {tab === "summary" ? (
                          <td className="px-3 py-2">
                            <Badge variant="neutral">
                              {meta?.label ?? r.channel}
                            </Badge>
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          <div className="text-xs text-neutral-700">
                            {r.periodFrom === r.periodTo
                              ? r.periodFrom
                              : `${r.periodFrom} → ${r.periodTo}`}
                          </div>
                          {r.bankCreditedAt ? (
                            <div className="text-[10px] text-neutral-500">
                              Bank credited{" "}
                              {jakartaDateOf(new Date(r.bankCreditedAt))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatRupiah(r.grossAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-danger-600">
                          {r.feeAmount > 0 ? formatRupiah(r.feeAmount) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-mahakan-green-700">
                          {formatRupiah(r.netAmount)}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-600">
                          {r.referenceNo ? (
                            <span className="font-mono">{r.referenceNo}</span>
                          ) : r.notes ? (
                            <span className="line-clamp-1">{r.notes}</span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {r.source === "auto_pos" ? (
                              <Badge variant="info">
                                <Sparkles className="size-3" aria-hidden />
                                Auto POS
                              </Badge>
                            ) : r.source === "csv" ? (
                              <Badge variant="neutral">
                                <Upload className="size-3" aria-hidden />
                                CSV
                              </Badge>
                            ) : null}
                            {r.lineItemsCount != null && r.lineItemsCount > 0 ? (
                              <Badge variant="success">
                                <FileText className="size-3" aria-hidden />
                                {r.lineItemsCount} order
                              </Badge>
                            ) : null}
                            {r.source === "manual" &&
                            (r.lineItemsCount == null ||
                              r.lineItemsCount === 0) ? (
                              <span className="text-[11px] text-neutral-400">
                                —
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {revisionBySettlement.get(r.id) ? (
                              <Badge variant="warning" title="Sudah direvisi">
                                Direvisi
                              </Badge>
                            ) : null}
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReviseId(r.id);
                              }}
                            >
                              Revisi
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-medium text-mahakan-green-700 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailId(r.id);
                              }}
                            >
                              Detail <ArrowRight className="size-3" aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AggregatorSettlementDetailModal
        settlementId={detailId}
        open={!!detailId}
        onClose={onDetailClose}
      />
      <AggregatorImportWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={onWizardSaved}
      />
      <CashlessMdrModal open={mdrOpen} onClose={() => setMdrOpen(false)} />
      <SettlementReclassModal
        open={reclassOpen}
        onClose={() => setReclassOpen(false)}
      />
      <SettlementRevisionModal
        settlementId={reviseId}
        open={!!reviseId}
        onClose={() => setReviseId(null)}
        onSaved={() => void revisionsQ.refetch()}
      />
    </div>
  );
}

/**
 * Sesi AE-165 — atur rate MDR per channel cashless langsung (QRIS/EDC BCA),
 * dipakai auto-generate settlement dari POS. Persen dari gross.
 */
function CashlessMdrModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [qris, setQris] = useState("");
  const [edc, setEdc] = useState("");
  /* Sesi AE-248 — potong MDR otomatis. Dimatikan atas permintaan owner:
   * potongan tebakan terlalu sering meleset dari mutasi m-banking. */
  const [autoMdr, setAutoMdr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* Sesi AE-219 — rekening tujuan pencairan per channel. Kosong = pakai
   * tebakan bawaan, dan tebakan itulah yang ditampilkan sebagai placeholder
   * supaya owner tahu ke mana uangnya SEKARANG dicatat. */
  const [bankMap, setBankMap] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<
    Array<{ code: string; name: string }>
  >([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    void (async () => {
      const [res, accRes] = await Promise.all([
        getCashlessMdrConfig(),
        fetchAccounts(),
      ]);
      if (cancelled) return;
      const cfg = res.ok
        ? res.data
        : {
            autoMdrEnabled: false,
            mdrQrisPct: 0.7,
            mdrEdcBcaPct: 0,
            bankAccountByChannel: {},
          };
      setAutoMdr(cfg.autoMdrEnabled === true);
      setQris(String(cfg.mdrQrisPct));
      setEdc(String(cfg.mdrEdcBcaPct));
      setBankMap(cfg.bankAccountByChannel ?? {});
      if (accRes.ok) {
        /* Hanya akun kas/bank (11xx aktif) — settlement tidak mungkin cair ke
         * akun beban atau persediaan. */
        setAccounts(
          accRes.data
            .filter(
              (a) => a.isActive && a.type === "asset" && a.code.startsWith("11"),
            )
            .map((a) => ({ code: a.code, name: a.name })),
        );
      }
      setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function onSave() {
    const q = Number(qris.replace(",", "."));
    const e = Number(edc.replace(",", "."));
    if (!Number.isFinite(q) || q < 0 || q > 10) {
      toast.error("Rate QRIS harus 0–10%");
      return;
    }
    if (!Number.isFinite(e) || e < 0 || e > 10) {
      toast.error("Rate EDC BCA harus 0–10%");
      return;
    }
    setSaving(true);
    const res = await updateCashlessMdrConfig({
      autoMdrEnabled: autoMdr,
      mdrQrisPct: q,
      mdrEdcBcaPct: e,
      bankAccountByChannel: bankMap,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Rate MDR disimpan");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pengaturan Cashless — MDR & Rekening Tujuan"
      description="Potongan provider (persen dari gross) dan ke rekening mana uang tiap channel benar-benar cair."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={onSave} loading={saving} disabled={loading}>
            Simpan
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-neutral-400" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* Sesi AE-248 — saklar di ATAS angka-angkanya: selama mati, rate di
              bawah tidak dipakai sama sekali, dan itu harus terbaca sebelum
              owner sempat bingung kenapa mengubah angkanya tidak berefek. */}
          <label className="col-span-2 flex items-start gap-2.5 rounded-lg border border-neutral-200 p-2.5">
            <input
              type="checkbox"
              checked={autoMdr}
              onChange={(ev) => setAutoMdr(ev.target.checked)}
              className="mt-0.5 size-4 accent-mahakan-green-700"
            />
            <span className="text-xs leading-relaxed">
              <span className="font-medium text-neutral-900">
                Potong MDR otomatis saat settlement dibuat
              </span>
              <span className="mt-0.5 block text-neutral-500">
                Mati = net settlement ditulis sama dengan gross, dan potongan
                yang benar-benar terjadi dicatat per tanggal lewat tombol
                Revisi, mengikuti mutasi m-banking. Nyalakan hanya kalau
                potongan banknya sudah konsisten dengan persentase di bawah.
              </span>
            </span>
          </label>
          <Input
            label="MDR QRIS (%)"
            type="text"
            inputMode="decimal"
            value={qris}
            onChange={(ev) => setQris(ev.target.value)}
            placeholder="0.7"
          />
          <Input
            label="MDR EDC BCA (%)"
            type="text"
            inputMode="decimal"
            value={edc}
            onChange={(ev) => setEdc(ev.target.value)}
            placeholder="0"
          />
          <p className="col-span-2 text-[11px] text-neutral-500">
            {autoMdr ? "" : "Saat ini MATI — angka di bawah tersimpan tapi belum dipakai. "}
            Default kalau belum diatur: QRIS 0,7% · EDC BCA 0%. Contoh: gross
            Rp 1.000.000, MDR QRIS 0,7% → fee Rp 7.000, net Rp 993.000.
          </p>

          {/* Sesi AE-219 — rekening tujuan per channel. Sebelum ini tujuannya
              ditebak dari nama channel ("EDC BNI → rekening BNI"), dan tebakan
              itu meleset untuk QRIS Mahakan yang cair ke BNI sementara
              jurnalnya mendebit BCA. Salah begini tidak memunculkan error apa
              pun — cuma saldo dua bank yang sama-sama meleset. */}
          <div className="col-span-2 mt-1 border-t border-neutral-200 pt-3">
            <p className="text-sm font-medium text-neutral-900">
              Uang tiap channel cair ke rekening mana?
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Dipakai saat jurnal settlement dibuat. Kosongkan kalau mau
              memakai bawaan. Ganti mesin EDC nanti cukup ubah di sini.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SETTLEMENT_CHANNELS.map((ch) => (
                <Select
                  key={ch}
                  label={SETTLEMENT_CHANNEL_LABEL[ch]}
                  size="sm"
                  options={[
                    {
                      value: "",
                      label: `— bawaan: ${defaultBankCodeForChannel(ch)} —`,
                    },
                    ...accounts.map((a) => ({
                      value: a.code,
                      label: `${a.code} · ${a.name}`,
                    })),
                  ]}
                  value={bankMap[ch] ?? ""}
                  onValueChange={(v) =>
                    setBankMap((prev) => ({ ...prev, [ch]: v }))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function KpiCard({
  label,
  value,
  sub,
  loading,
  accent = "default",
  Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
  accent?: "default" | "danger" | "success";
  Icon?: typeof TrendingUp;
}) {
  const accentClass =
    accent === "danger"
      ? "text-danger-600"
      : accent === "success"
        ? "text-mahakan-green-700"
        : "text-neutral-900";
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <p className={cn("mt-1 truncate text-xl font-bold font-mono", accentClass)}>
              {value}
            </p>
          )}
          {sub && !loading ? (
            <p className="mt-0.5 text-[10px] text-neutral-500">{sub}</p>
          ) : null}
        </div>
        {Icon ? (
          <Icon
            className={cn("size-4 shrink-0", accentClass)}
            aria-hidden
          />
        ) : null}
      </div>
    </Card>
  );
}

/* Unused for now but kept for future per-channel column. */
export { ExternalLink };

/**
 * Sesi AE-219 — pindahkan jurnal settlement yang terlanjur mendarat di
 * rekening yang salah.
 *
 * Kejadian nyata: QRIS cair ke BNI, tapi 98 jurnal settlement mendebit Bank
 * BCA karena tujuannya dulu ditebak dari nama channel. Layar ini menunjukkan
 * DULU berapa yang mendarat di rekening mana per bulan, baru owner memutuskan
 * mana yang dipindah — termasuk sejak kapan, karena bank akuisisi bisa saja
 * memang baru berganti di tengah jalan.
 */
function SettlementReclassModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<SettlementChannel>("qris");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toCode, setToCode] = useState("");
  const [reason, setReason] = useState("");
  const [accounts, setAccounts] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [preview, setPreview] = useState<SettlementReclassPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    const today = todayJakarta();
    setChannel("qris");
    setFrom(addDaysJakarta(today, -365));
    setTo(today);
    setToCode("");
    setReason("");
    setPreview(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await fetchAccounts();
      if (cancelled || !res.ok) return;
      setAccounts(
        res.data
          .filter(
            (a) => a.isActive && a.type === "asset" && a.code.startsWith("11"),
          )
          .map((a) => ({ code: a.code, name: a.name })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function onPreview() {
    if (!toCode || !from || !to) {
      setError("Pilih rekening tujuan dan rentang tanggalnya dulu.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await previewSettlementBankReclass({
      channel,
      from,
      to,
      toCode,
    });
    setLoading(false);
    if (res.ok) setPreview(res.data);
    else {
      setPreview(null);
      setError(res.error.message);
    }
  }

  async function onPost() {
    if (!preview || posting) return;
    const postable = preview.rows.filter((r) => r.blockedReason === null);
    if (postable.length === 0) {
      setError("Tidak ada bulan yang bisa dipindah.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Alasan pemindahan minimal 10 karakter.");
      return;
    }
    if (
      !window.confirm(
        `Pindahkan ${formatRupiah(preview.postableAmount)} dari rekening lama ke ${preview.toCode} ${preview.toName}?\n\n${postable.length} jurnal pemindahan akan dibuat (satu per bulan).`,
      )
    ) {
      return;
    }
    setPosting(true);
    const res = await postSettlementBankReclass({
      channel,
      from,
      to,
      toCode,
      reason: reason.trim(),
    });
    setPosting(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(
      `${res.data.posted.length} jurnal pemindahan dibuat — total ${formatRupiah(res.data.totalMoved)}.`,
    );
    if (res.data.skipped.length > 0) {
      toast.error(
        `${res.data.skipped.length} bulan dilewati: ${res.data.skipped[0].reason}`,
      );
    }
    void onPreview();
    setReason("");
  }

  const blockedRows = preview?.rows.filter((r) => r.blockedReason !== null) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pindah Rekening Jurnal Settlement"
      description="Untuk settlement yang sudah terlanjur dijurnal ke rekening yang salah. Jurnal aslinya tidak diusik — saldonya dipindah lewat satu jurnal per bulan, supaya saldo tiap bulan ikut benar."
      size="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">
            {preview
              ? `${preview.rows.length} bulan ditemukan · bisa dipindah ${formatRupiah(preview.postableAmount)}`
              : "Pilih channel + rekening tujuan, lalu Lihat Rincian"}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={posting}>
              Tutup
            </Button>
            <Button variant="outline" onClick={onPreview} loading={loading}>
              Lihat Rincian
            </Button>
            <Button
              onClick={onPost}
              loading={posting}
              disabled={
                posting ||
                !preview ||
                preview.rows.filter((r) => r.blockedReason === null).length === 0
              }
            >
              <ArrowLeftRight className="size-4" aria-hidden /> Pindahkan
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Channel"
            options={SETTLEMENT_CHANNELS.map((c) => ({
              value: c,
              label: SETTLEMENT_CHANNEL_LABEL[c],
            }))}
            value={channel}
            onValueChange={(v) => {
              setChannel(v as SettlementChannel);
              setPreview(null);
            }}
          />
          <Select
            label="Rekening tujuan yang benar"
            options={accounts.map((a) => ({
              value: a.code,
              label: `${a.code} · ${a.name}`,
            }))}
            value={toCode}
            onValueChange={(v) => {
              setToCode(v);
              setPreview(null);
            }}
            placeholder="— pilih rekening —"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Dari tanggal"
            value={from}
            onChange={(v) => {
              setFrom(v ?? "");
              setPreview(null);
            }}
          />
          <DatePicker
            label="Sampai tanggal"
            value={to}
            onChange={(v) => {
              setTo(v ?? "");
              setPreview(null);
            }}
          />
        </div>
        <p className="text-[11px] text-neutral-500">
          Kalau bank akuisisinya memang baru berganti di tengah jalan, sempitkan
          rentangnya — yang di luar rentang tidak akan disentuh.
        </p>

        {preview ? (
          preview.rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
              Semua jurnal settlement {preview.channelLabel} di rentang itu
              sudah mendarat di {preview.toCode} {preview.toName}. Tidak ada
              yang perlu dipindah.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-neutral-200">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Bulan</th>
                    <th className="px-3 py-1.5 text-left font-medium">
                      Tercatat di
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Jumlah
                    </th>
                    <th className="px-3 py-1.5 text-center font-medium">
                      Settlement
                    </th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.rows.map((r) => (
                    <tr key={`${r.month}-${r.fromCode}`}>
                      <td className="px-3 py-1.5">{r.monthLabel}</td>
                      <td className="px-3 py-1.5 font-mono">
                        {r.fromCode} {r.fromName}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {formatRupiah(r.amount)}
                      </td>
                      <td className="px-3 py-1.5 text-center text-neutral-500">
                        {r.entryCount}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.blockedReason ? (
                          <span className="text-danger-600">
                            {r.blockedReason}
                          </span>
                        ) : (
                          <Badge variant="success">Siap dipindah</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {preview && preview.configuredCode !== preview.toCode ? (
          <div className="rounded-md border border-warning-500/40 bg-warning-100/40 p-3 text-xs text-neutral-700">
            <AlertTriangle
              className="mr-1.5 inline size-3.5 text-warning-500"
              aria-hidden
            />
            Settlement BARU untuk {preview.channelLabel} masih akan masuk ke
            akun <b>{preview.configuredCode}</b>. Kalau {preview.toCode} yang
            benar, ubah juga di <b>MDR &amp; Rekening</b> — kalau tidak,
            masalahnya berulang bulan depan.
          </div>
        ) : null}

        {preview && preview.rows.length > 0 ? (
          <Input
            label="Alasan pemindahan (wajib)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. QRIS cair ke rekening BNI, jurnalnya terlanjur mendebit BCA"
          />
        ) : null}

        {blockedRows.length > 0 ? (
          <p className="text-[11px] text-neutral-500">
            {blockedRows.length} bulan tidak bisa dipindah karena periodenya
            sudah tutup buku / terkunci. Buka dulu di Akuntansi → Periode kalau
            memang mau dibetulkan.
          </p>
        ) : null}

        {error ? (
          <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-600">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Sesi AE-246 — REVISI SETTLEMENT satu hari.
 *
 * Owner mengetik apa yang benar-benar masuk ke rekening menurut rekening
 * koran; jurnal penyeimbangnya dibuat otomatis. Rekening tujuan ditanyakan
 * karena dalam satu bulan uangnya bisa mendarat di bank yang berbeda-beda.
 */
function SettlementRevisionModal({
  settlementId,
  open,
  onClose,
  onSaved,
}: {
  settlementId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ctx, setCtx] = useState<SettlementRevisionContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [reason, setReason] = useState("");
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Sesi AE-248 — membatalkan revisi yang sudah berlaku. Tanpa jalan ini,
   * owner yang salah merevisi akan membatalkan jurnal SETTLEMENT-nya (itu
   * yang terjadi 4 Okt) — jurnal revisinya jadi yatim dan menggeser saldo
   * bank untuk settlement yang sudah tidak ada. */
  const [reversing, setReversing] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  /* Sesi AE-250 — jurnal settlement yang terlanjur dibatalkan bisa diposting
   * ulang dari sini. Tanpa ini settlement-nya masih ada tapi piutangnya tidak
   * pernah dibersihkan, dan satu-satunya perbaikan adalah menghapus lalu
   * membuat ulang settlement-nya — jejaknya ikut hilang. */
  const [reposting, setReposting] = useState(false);
  const [repostReason, setRepostReason] = useState("");

  useEffect(() => {
    if (!open || !settlementId) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setCtx(null);
    setAmount("");
    setAccountCode("");
    setReason("");
    setReverseReason("");
    setRepostReason("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [c, accs] = await Promise.all([
        getSettlementRevisionContext({ settlementId }),
        fetchAccounts({ isActive: true }),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (accs.ok) {
        setAccounts(accs.data.filter((a) => /^11\d{2}$/.test(a.code)));
      }
      if (!c.ok) {
        setError(c.error.message);
        return;
      }
      setCtx(c.data);
      /* Pra-isi dengan yang tercatat sekarang: yang paling sering berubah cuma
       * salah satunya — rekeningnya saja, atau nominalnya saja. */
      setAmount(String(c.data.recordedAmount));
      setAccountCode(c.data.recordedAccountCode);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, settlementId]);

  const actual = (() => {
    try {
      return parseRupiah(amount);
    } catch {
      return NaN;
    }
  })();
  const diff =
    ctx && Number.isFinite(actual) ? actual - ctx.recordedAmount : null;
  const changed =
    ctx !== null &&
    Number.isFinite(actual) &&
    (actual !== ctx.recordedAmount || accountCode !== ctx.recordedAccountCode);

  async function doRepost() {
    if (!ctx || reposting) return;
    setError(null);
    setReposting(true);
    const res = await repostSettlementJournal({
      settlementId: ctx.settlementId,
      reason: repostReason.trim(),
    });
    setReposting(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success(`Jurnal diposting ulang — ${res.data.entryNumber}`);
    onSaved();
    onClose();
  }

  async function doReverse() {
    if (!ctx?.activeRevision || reversing) return;
    setError(null);
    const res = await (async () => {
      setReversing(true);
      const r = await reverseSettlementRevision({
        id: ctx.activeRevision!.id,
        reason: reverseReason.trim(),
      });
      setReversing(false);
      return r;
    })();
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Revisi dibatalkan");
    onSaved();
    onClose();
  }

  async function submit() {
    if (!ctx || submitting) return;
    setError(null);
    if (!Number.isFinite(actual) || actual < 0) {
      setError("Nominal tidak valid");
      return;
    }
    if (!accountCode) {
      setError("Pilih dulu rekening yang menerima uangnya");
      return;
    }
    if (!changed) {
      setError("Nominal dan rekeningnya sama dengan yang sudah tercatat");
      return;
    }
    setSubmitting(true);
    const res = await postSettlementRevision({
      settlementId: ctx.settlementId,
      actualAmount: Math.round(actual),
      actualAccountCode: accountCode,
      reason,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Revisi settlement tercatat");
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revisi Settlement"
      description="Catat uang yang benar-benar masuk ke rekening. Jurnal penyeimbangnya dibuat otomatis."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !ctx ||
              !ctx.hasPostedJournal ||
              ctx.alreadyRevised
            }
          >
            {submitting ? "Menyimpan…" : "Simpan Revisi"}
          </Button>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : !ctx ? (
        <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
          {error ?? "Settlement tidak bisa dimuat"}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-neutral-50 p-3 text-xs">
            <p className="font-medium text-neutral-900">
              {ctx.channelLabel} · {ctx.entryDate}
            </p>
            <div className="mt-1.5 flex justify-between">
              <span className="text-neutral-600">Tercatat di sistem</span>
              <span className="font-mono">
                {formatRupiah(ctx.recordedAmount)}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-neutral-600">Tercatat di rekening</span>
              <span className="font-mono">
                {ctx.recordedAccountCode} · {ctx.recordedAccountName}
              </span>
            </div>
            {/* Sesi AE-249 — kalau saldonya sudah dipindah, katakan. Tanpa ini
                owner melihat rekening yang berbeda dari jurnal settlement-nya
                dan mengira layarnya salah. */}
            {ctx.movedFromCode ? (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                Saldonya sudah dipindah dari {ctx.movedFromCode} lewat Pindah
                Rekening, jadi titik berangkat revisi ini adalah{" "}
                {ctx.recordedAccountCode} — bukan rekening di jurnal aslinya.
              </p>
            ) : null}
          </div>

          {ctx.journalReversed ? (
            <div className="rounded-lg border border-warning-500/40 bg-warning-100/30 p-2.5 text-xs">
              <p className="font-medium text-neutral-900">
                Jurnal settlement ini sudah dibatalkan
              </p>
              <p className="mt-1 leading-relaxed text-neutral-600">
                Settlement-nya sendiri masih ada. Selama jurnalnya belum
                kembali, piutangnya tidak pernah dibersihkan dan saldo bank
                kurang sebesar nilai ini. Kalau uangnya memang masuk, posting
                ulang jurnalnya — nilainya diambil dari settlement yang sama,
                jadi tidak ada yang diketik ulang.
              </p>
              <div className="mt-2 flex items-end gap-2">
                <Input
                  label="Alasan posting ulang"
                  value={repostReason}
                  onChange={(e) => setRepostReason(e.target.value)}
                  placeholder="Misal: jurnal kebatalan saat memperbaiki revisi"
                />
                <Button
                  size="sm"
                  onClick={() => void doRepost()}
                  disabled={reposting || repostReason.trim().length < 10}
                >
                  {reposting ? "Memposting…" : "Posting Ulang Jurnal"}
                </Button>
              </div>
            </div>
          ) : null}

          {/* Sesi AE-248 — salah revisi dibereskan DI SINI, bukan dengan
              membatalkan jurnal settlement-nya. Membatalkan jurnalnya akan
              meninggalkan jurnal revisi yang yatim: saldo bank tergeser untuk
              settlement yang sudah tidak ada, tanpa jurnal yang timpang. */}
          {ctx.activeRevision ? (
            <div className="rounded-lg border border-warning-500/40 bg-warning-100/30 p-2.5 text-xs">
              <p className="font-medium text-neutral-900">
                Sudah pernah direvisi
              </p>
              <p className="mt-1 leading-relaxed text-neutral-600">
                {formatRupiah(ctx.activeRevision.recordedAmount)} di{" "}
                {ctx.activeRevision.recordedAccountCode} →{" "}
                {formatRupiah(ctx.activeRevision.actualAmount)} di{" "}
                {ctx.activeRevision.actualAccountCode}
                {ctx.activeRevision.reason
                  ? ` · ${ctx.activeRevision.reason}`
                  : ""}
              </p>
              <p className="mt-1.5 leading-relaxed text-neutral-600">
                Mau memperbaiki? Batalkan revisi ini dulu, baru simpan yang
                baru. Jangan membatalkan jurnal settlement-nya.
              </p>
              <div className="mt-2 flex items-end gap-2">
                <Input
                  label="Alasan pembatalan"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Misal: salah ketik nominal"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void doReverse()}
                  disabled={reversing || reverseReason.trim().length < 5}
                >
                  {reversing ? "Membatalkan…" : "Batalkan Revisi"}
                </Button>
              </div>
            </div>
          ) : null}

          <Input
            label="Uang yang benar-benar masuk (Rp)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint="Lihat rekening koran. Isi 0 kalau uangnya tidak pernah masuk."
          />
          <Select
            label="Masuk rekening apa"
            value={accountCode}
            onValueChange={setAccountCode}
            options={accounts.map((a) => ({
              value: a.code,
              label: `${a.code} · ${a.name}`,
            }))}
            placeholder="Pilih rekening penerima"
          />
          <Input
            label="Alasan revisi"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Misal: potongan MDR beda, cair ke Mandiri"
            hint="Minimal 10 huruf — ini yang dibaca saat rekening koran dicocokkan nanti."
          />

          {/* Pratinjau dampaknya sebelum disimpan: selisih yang tidak
              diperlihatkan di muka biasanya baru ketahuan saat laba rugi
              dibaca sebulan kemudian. */}
          {diff !== null && changed ? (
            <div className="rounded-lg border border-neutral-200 p-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-600">Selisih</span>
                <span
                  className={cn(
                    "font-mono font-medium",
                    diff < 0 ? "text-danger-600" : diff > 0 ? "text-mahakan-green-700" : "",
                  )}
                >
                  {diff > 0 ? "+" : ""}
                  {formatRupiah(diff)}
                </span>
              </div>
              <p className="mt-1.5 leading-relaxed text-neutral-500">
                {diff === 0
                  ? `Nominalnya sama, hanya rekeningnya yang pindah ke ${accountCode}.`
                  : diff < 0
                    ? `Uang yang masuk lebih kecil. Selisihnya masuk Biaya MDR (6402) — potongannya ternyata lebih besar dari perkiraan.`
                    : `Uang yang masuk lebih besar. Biaya MDR (6402) dikurangi sebesar selisihnya — bukan dicatat sebagai penjualan baru.`}
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

