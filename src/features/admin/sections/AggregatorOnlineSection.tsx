"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
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
  DateRangePicker,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  fetchAggregatorSettlements,
  generateCashlessSettlementFromPos,
  getCashlessMdrConfig,
  updateCashlessMdrConfig,
} from "@/features/finance/actions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sesi AE-77 — Short rupiah format for axis ticks & compact KPI subtitle. */
function formatRupiahShort(n: number): string {
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}rb`;
  return formatRupiah(n);
}
import { AggregatorSettlementDetailModal } from "./aggregator-online/AggregatorSettlementDetailModal";
import { AggregatorImportWizardModal } from "./aggregator-online/AggregatorImportWizardModal";

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

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export function AggregatorOnlineSection() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("summary");
  const [range, setRange] = useState<{ from: string; to: string }>(
    defaultRange(),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  /* Sesi AE-165 — auto-generate QRIS/EDC dari POS + config MDR. */
  const [generating, setGenerating] = useState(false);
  const [mdrOpen, setMdrOpen] = useState(false);

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
            aria-label="Atur rate MDR"
          >
            <Settings2 className="size-4" aria-hidden /> Rate MDR
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
                              {new Date(r.bankCreditedAt)
                                .toISOString()
                                .slice(0, 10)}
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    void (async () => {
      const res = await getCashlessMdrConfig();
      if (cancelled) return;
      const cfg = res.ok ? res.data : { mdrQrisPct: 0.7, mdrEdcBcaPct: 0 };
      setQris(String(cfg.mdrQrisPct));
      setEdc(String(cfg.mdrEdcBcaPct));
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
      mdrQrisPct: q,
      mdrEdcBcaPct: e,
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
      title="Rate MDR — QRIS & EDC BCA"
      description="Potongan provider (persen dari gross). Dipakai saat auto-generate settlement dari POS: Net = Gross − (Gross × rate)."
      size="md"
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
            Default kalau belum diatur: QRIS 0,7% · EDC BCA 0%. Contoh: gross
            Rp 1.000.000, MDR QRIS 0,7% → fee Rp 7.000, net Rp 993.000.
          </p>
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
