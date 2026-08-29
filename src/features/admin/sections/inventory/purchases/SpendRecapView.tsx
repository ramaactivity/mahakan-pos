"use client";

/**
 * Sesi AE-222 — tab "Rekap Belanja" di modul Purchasing.
 *
 * Pertanyaan owner yang dijawab layar ini, berurutan dari atas ke bawah:
 *   1. Bulan ini uang belanja bahan habis berapa, naik atau turun?
 *   2. Perginya ke mana (dapur/bar/pendukung/kebersihan)?
 *   3. Polanya bagaimana dari waktu ke waktu?
 *   4. Rinciannya apa saja, dan angka itu datang dari nota yang mana?
 *
 * Angka yang dihitung adalah barang yang BENAR-BENAR DITERIMA (GR + pembelian
 * instan), bukan PO yang baru dipesan, supaya rekap ini bisa diadu dengan
 * Laba Rugi dan Buku Besar. PO menggantung dilaporkan terpisah di bawah.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  Combobox,
  DateRangePicker,
  EmptyCard,
  Input,
  Select,
  Skeleton,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  getPurchaseSpendRecap,
  isOk,
  listPurchaseSpendDetail,
  formatDayLabel,
  formatRangeLabel,
  spendDeltaPercent,
  SPEND_DIMENSION_LABELS,
  SPEND_PAYMENT_LABELS,
  SPEND_SECTION_LABELS,
  type SpendDateBasis,
  type SpendDimension,
  type SpendFilters,
  type SpendGroupRow,
  type SpendLine,
  type SpendPaymentMethod,
  type SpendRecapResult,
  type SpendSection,
} from "@/features/purchases";
import type { ApiResult } from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
import { monthStartJakarta, todayJakarta } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  buildSpendDetailCsv,
  buildSpendSummaryCsv,
  downloadCsv,
  spendCsvFilename,
} from "./spend-recap-csv";

/* Satu ramp hijau untuk tiga section bahan (bagian dari satu keseluruhan),
 * satu amber untuk kebersihan yang memang bukan bahan pangan, netral untuk
 * yang belum dikategorikan. Bukan pelangi: warnanya harus terbaca sebagai
 * potongan dari kue yang sama. */
const SECTION_COLOR: Record<SpendSection, string> = {
  kitchen: "#2e5b43",
  bar: "#529270",
  supporting: "#9dc7b1",
  cleaning: "#b4762f",
  unassigned: "#cfcbbf",
};

type SpendDetailResult = ApiResult<{
  lines: SpendLine[];
  truncated: boolean;
  total: number;
}>;

const DIMENSIONS: SpendDimension[] = [
  "month",
  "date",
  "section",
  "ingredient",
  "supplier",
  "paymentMethod",
];

type SortMode = "amount_desc" | "amount_asc" | "label_asc" | "chrono";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "amount_desc", label: "Rupiah terbesar" },
  { value: "amount_asc", label: "Rupiah terkecil" },
  { value: "label_asc", label: "Nama A ke Z" },
  { value: "chrono", label: "Urut waktu" },
];

const PRESET_KEYS = ["month", "prev_month", "d30", "d90", "ytd"] as const;
type PresetKey = (typeof PRESET_KEYS)[number];

const PRESET_LABELS: Record<PresetKey, string> = {
  month: "Bulan ini",
  prev_month: "Bulan lalu",
  d30: "30 hari",
  d90: "90 hari",
  ytd: "Tahun ini",
};

function shiftIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = todayJakarta();
  switch (key) {
    case "month":
      return { from: monthStartJakarta(today), to: today };
    case "prev_month": {
      const firstOfThis = monthStartJakarta(today);
      const lastOfPrev = shiftIso(firstOfThis, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
    case "d30":
      return { from: shiftIso(today, -29), to: today };
    case "d90":
      return { from: shiftIso(today, -89), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** "Rp 6,7jt" untuk sumbu grafik dan chip yang sempit. */
function compactRupiah(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${Math.round(n / 100_000_000) / 10} M`;
  if (abs >= 1_000_000) return `${Math.round(n / 100_000) / 10} jt`;
  if (abs >= 1_000) return `${Math.round(n / 100) / 10} rb`;
  return String(n);
}

function formatQty(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(n);
}

function sharePct(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return "<0,1%";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(pct)}%`;
}

function sortRows(rows: SpendGroupRow[], mode: SortMode): SpendGroupRow[] {
  const copy = [...rows];
  switch (mode) {
    case "amount_desc":
      return copy.sort((a, b) => b.amount - a.amount);
    case "amount_asc":
      return copy.sort((a, b) => a.amount - b.amount);
    case "label_asc":
      return copy.sort((a, b) => a.label.localeCompare(b.label, "id"));
    case "chrono":
      return copy.sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  }
}

export function SpendRecapView() {
  const today = todayJakarta();
  const [range, setRange] = useState<DateRangeValue>({
    from: monthStartJakarta(today),
    to: today,
  });
  const [dateBasis, setDateBasis] = useState<SpendDateBasis>("receipt");
  const [section, setSection] = useState<SpendSection | "all">("all");
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<SpendPaymentMethod | "all">("all");
  const [paymentStatus, setPaymentStatus] = useState<"all" | "paid" | "pending_payment">("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [dimension, setDimension] = useState<SpendDimension>("ingredient");
  const [sortMode, setSortMode] = useState<SortMode>("amount_desc");
  const [expandAll, setExpandAll] = useState(false);

  const [data, setData] = useState<SpendRecapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  /* Ketikan pencarian tidak boleh memicu satu query per huruf. */
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchDraft), 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const filters: SpendFilters = useMemo(
    () => ({
      section,
      ingredientId,
      supplierId,
      paymentMethod,
      paymentStatus,
      search,
    }),
    [section, ingredientId, supplierId, paymentMethod, paymentStatus, search],
  );

  const from = range.from ?? monthStartJakarta(today);
  const to = range.to ?? today;

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getPurchaseSpendRecap({
      dateFrom: from,
      dateTo: to,
      dateBasis,
      filters,
    })
      .then((res) => {
        if (!alive) return;
        /* Gagal = tampilkan pesannya, JANGAN kosongkan layar. Rentang yang
         * salah ketik sesaat tidak boleh membuang angka yang sudah terbaca. */
        if (isOk(res)) setData(res.data);
        else toast.error(res.error.message);
      })
      .catch(() => {
        if (alive) toast.error("Gagal memuat rekap pembelanjaan");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [from, to, dateBasis, filters, refreshKey]);

  /* Ganti dimensi = kejadian, bukan sinkronisasi: urutan bawaan dan potongan
   * "20 teratas" di-set di sini, bukan lewat effect yang menyusul render. */
  const changeDimension = (d: SpendDimension) => {
    setDimension(d);
    setSortMode(d === "month" || d === "date" ? "chrono" : "amount_desc");
    setExpandAll(false);
  };

  const rowsRaw = useMemo(() => {
    if (!data) return [];
    switch (dimension) {
      case "month":
        return data.byMonth;
      case "date":
        return data.byDate;
      case "section":
        return data.bySection;
      case "ingredient":
        return data.byIngredient;
      case "supplier":
        return data.bySupplier;
      case "paymentMethod":
        return data.byPaymentMethod;
    }
  }, [data, dimension]);

  const rows = useMemo(() => sortRows(rowsRaw, sortMode), [rowsRaw, sortMode]);

  /* Identitas data yang sedang tampil. Dipakai sebagai bagian key baris supaya
   * rincian yang tadi dibuka tidak tertinggal memperlihatkan angka periode
   * atau filter yang LAMA setelah owner mengganti filter. */
  const detailToken = useMemo(
    () => JSON.stringify({ from, to, dateBasis, filters }),
    [from, to, dateBasis, filters],
  );
  const VISIBLE_CAP = 20;
  const visibleRows = expandAll ? rows : rows.slice(0, VISIBLE_CAP);

  const activeFilterCount =
    (section !== "all" ? 1 : 0) +
    (ingredientId ? 1 : 0) +
    (supplierId ? 1 : 0) +
    (paymentMethod !== "all" ? 1 : 0) +
    (paymentStatus !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const resetFilters = () => {
    setSection("all");
    setIngredientId(null);
    setSupplierId(null);
    setPaymentMethod("all");
    setPaymentStatus("all");
    setSearch("");
    setSearchDraft("");
  };

  const handleExportSummary = () => {
    if (!data || rows.length === 0) return;
    downloadCsv(
      spendCsvFilename("ringkasan", SPEND_DIMENSION_LABELS[dimension], data.appliedFrom, data.appliedTo),
      buildSpendSummaryCsv({
        dimensionLabel: SPEND_DIMENSION_LABELS[dimension],
        rows,
        total: data.summary.total,
      }),
    );
  };

  const handleExportDetail = async () => {
    if (!data) return;
    const res = await listPurchaseSpendDetail({
      dateFrom: from,
      dateTo: to,
      dateBasis,
      filters,
      limit: 2000,
    });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.lines.length === 0) {
      toast.info("Tidak ada baris untuk diekspor");
      return;
    }
    downloadCsv(
      spendCsvFilename("rincian", "baris", data.appliedFrom, data.appliedTo),
      buildSpendDetailCsv(res.data.lines),
    );
    if (res.data.truncated) {
      toast.info("Ekspor dipotong di 2.000 baris. Persempit rentang untuk data penuh.");
    }
  };

  return (
    <div className="space-y-6">
      <Toolbar
        range={range}
        onRangeChange={setRange}
        dateBasis={dateBasis}
        onDateBasisChange={setDateBasis}
        onPreset={(k) => setRange(presetRange(k))}
        onRefresh={() => setRefreshKey((n) => n + 1)}
        loading={loading}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
        activeFilterCount={activeFilterCount}
      />

      {showFilters && (
        <FilterPanel
          data={data}
          section={section}
          onSection={setSection}
          ingredientId={ingredientId}
          onIngredient={setIngredientId}
          supplierId={supplierId}
          onSupplier={setSupplierId}
          paymentMethod={paymentMethod}
          onPaymentMethod={setPaymentMethod}
          paymentStatus={paymentStatus}
          onPaymentStatus={setPaymentStatus}
          searchDraft={searchDraft}
          onSearchDraft={setSearchDraft}
          activeFilterCount={activeFilterCount}
          onReset={resetFilters}
        />
      )}

      {loading && !data ? (
        <LoadingState />
      ) : !data ? (
        <EmptyCard
          title="Rekap tidak bisa dimuat"
          description="Coba muat ulang, atau persempit rentang tanggalnya."
        />
      ) : (
        <>
          <Headline data={data} loading={loading} />
          <SectionComposition
            data={data}
            activeSection={section}
            onPick={(s) => setSection((cur) => (cur === s ? "all" : s))}
          />
          <TrendChart data={data} />
          <BreakdownPanel
            data={data}
            dimension={dimension}
            onDimension={changeDimension}
            rows={rows}
            visibleRows={visibleRows}
            detailToken={detailToken}
            expandAll={expandAll}
            onExpandAll={() => setExpandAll(true)}
            sortMode={sortMode}
            onSortMode={setSortMode}
            onExportSummary={handleExportSummary}
            onExportDetail={handleExportDetail}
            requestDetail={(key) =>
              listPurchaseSpendDetail({
                dateFrom: from,
                dateTo: to,
                dateBasis,
                filters,
                dimension,
                dimensionKey: key,
                limit: 200,
              })
            }
          />
          <Footnotes data={data} />
        </>
      )}
    </div>
  );
}

/* ========================================================================== */

function Toolbar(props: {
  range: DateRangeValue;
  onRangeChange: (v: DateRangeValue) => void;
  dateBasis: SpendDateBasis;
  onDateBasisChange: (v: SpendDateBasis) => void;
  onPreset: (k: PresetKey) => void;
  onRefresh: () => void;
  loading: boolean;
  showFilters: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          label="Rentang tanggal"
          value={props.range}
          onChange={props.onRangeChange}
          className="min-w-[16rem]"
        />
        <Select
          label="Tanggal dihitung dari"
          size="md"
          value={props.dateBasis}
          onValueChange={(v) => props.onDateBasisChange(v as SpendDateBasis)}
          options={[
            { value: "receipt", label: "Barang diterima" },
            { value: "purchase", label: "Tanggal nota" },
          ]}
          className="min-w-[12rem]"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={props.onToggleFilters}
            aria-expanded={props.showFilters}
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Filter
            {props.activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-mahakan-green-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {props.activeFilterCount}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={props.onRefresh}
            aria-label="Muat ulang rekap"
          >
            <RefreshCw
              className={cn("size-4", props.loading && "animate-spin")}
              aria-hidden
            />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESET_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => props.onPreset(k)}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-mahakan-green-300 hover:bg-mahakan-green-50 hover:text-mahakan-green-900 touch:py-2"
          >
            {PRESET_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterPanel(props: {
  data: SpendRecapResult | null;
  section: SpendSection | "all";
  onSection: (v: SpendSection | "all") => void;
  ingredientId: string | null;
  onIngredient: (v: string | null) => void;
  supplierId: string | null;
  onSupplier: (v: string | null) => void;
  paymentMethod: SpendPaymentMethod | "all";
  onPaymentMethod: (v: SpendPaymentMethod | "all") => void;
  paymentStatus: "all" | "paid" | "pending_payment";
  onPaymentStatus: (v: "all" | "paid" | "pending_payment") => void;
  searchDraft: string;
  onSearchDraft: (v: string) => void;
  activeFilterCount: number;
  onReset: () => void;
}) {
  const ingredientOptions = useMemo(
    () =>
      (props.data?.ingredientOptions ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        hint: formatRupiah(o.amount),
      })),
    [props.data],
  );
  const supplierOptions = useMemo(
    () =>
      (props.data?.supplierOptions ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        hint: formatRupiah(o.amount),
      })),
    [props.data],
  );

  return (
    <Card variant="flat" className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Select
          label="Section"
          size="sm"
          value={props.section}
          onValueChange={(v) => props.onSection(v as SpendSection | "all")}
          options={[
            { value: "all", label: "Semua section" },
            ...(Object.keys(SPEND_SECTION_LABELS) as SpendSection[]).map((s) => ({
              value: s,
              label: SPEND_SECTION_LABELS[s],
            })),
          ]}
        />
        <Combobox
          label="Bahan"
          size="sm"
          clearable
          value={props.ingredientId}
          onChange={props.onIngredient}
          options={ingredientOptions}
          placeholder="Semua bahan"
          searchPlaceholder="Cari bahan…"
          emptyText="Tidak ada bahan di rentang ini"
        />
        <Combobox
          label="Supplier"
          size="sm"
          clearable
          value={props.supplierId}
          onChange={props.onSupplier}
          options={supplierOptions}
          placeholder="Semua supplier"
          searchPlaceholder="Cari supplier…"
          emptyText="Tidak ada supplier di rentang ini"
        />
        <Select
          label="Metode bayar"
          size="sm"
          value={props.paymentMethod}
          onValueChange={(v) => props.onPaymentMethod(v as SpendPaymentMethod | "all")}
          options={[
            { value: "all", label: "Semua metode" },
            ...(Object.keys(SPEND_PAYMENT_LABELS) as SpendPaymentMethod[]).map((m) => ({
              value: m,
              label: SPEND_PAYMENT_LABELS[m],
            })),
          ]}
        />
        <Select
          label="Status bayar"
          size="sm"
          value={props.paymentStatus}
          onValueChange={(v) =>
            props.onPaymentStatus(v as "all" | "paid" | "pending_payment")
          }
          options={[
            { value: "all", label: "Semua status" },
            { value: "paid", label: "Sudah lunas" },
            { value: "pending_payment", label: "Belum lunas" },
          ]}
        />
        <Input
          label="Cari"
          value={props.searchDraft}
          onChange={(e) => props.onSearchDraft(e.target.value)}
          placeholder="Nama bahan, supplier, atau no. nota"
          leadingIcon={<Search className="size-4" aria-hidden />}
        />
      </div>
      {props.activeFilterCount > 0 && (
        <button
          type="button"
          onClick={props.onReset}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 underline underline-offset-2 hover:text-mahakan-green-800"
        >
          <X className="size-3.5" aria-hidden /> Hapus semua filter (
          {props.activeFilterCount})
        </button>
      )}
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-4 w-full rounded-full" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/**
 * Angka utama tidak dibungkus kartu dan tidak diberi label besar: satu total,
 * satu kalimat perbandingan, satu baris konteks. Deretan kartu KPI kembar
 * justru membuat angka terpenting kehilangan bobotnya.
 */
function Headline({ data, loading }: { data: SpendRecapResult; loading: boolean }) {
  const s = data.summary;
  const delta = spendDeltaPercent(s.total, data.previousTotal);
  const naik = delta !== null && delta > 0;
  const turun = delta !== null && delta < 0;

  return (
    <section className={cn("space-y-3", loading && "opacity-60 transition-opacity")}>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Total belanja bahan baku
      </p>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <p className="font-mono text-4xl font-bold leading-none text-mahakan-green-900 tabular-nums xl:text-5xl">
          {formatRupiah(s.total)}
        </p>
        {delta !== null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold",
              naik && "text-danger-600",
              turun && "text-success-500",
              !naik && !turun && "text-neutral-600",
            )}
          >
            {naik ? (
              <ArrowUp className="size-4" aria-hidden />
            ) : turun ? (
              <ArrowDown className="size-4" aria-hidden />
            ) : (
              <ArrowRight className="size-4" aria-hidden />
            )}
            {Math.abs(delta) < 0.5
              ? "setara"
              : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.abs(delta))}%`}
            <span className="font-normal text-neutral-600">
              dari {formatRupiah(data.previousTotal ?? 0)} di{" "}
              {data.previousFrom && data.previousTo
                ? formatRangeLabel(data.previousFrom, data.previousTo)
                : "periode sebelumnya"}
            </span>
          </span>
        ) : (
          <span className="text-sm text-neutral-500">
            Belum ada periode pembanding
          </span>
        )}
      </div>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm text-neutral-700">
        <Stat label="Periode" value={formatRangeLabel(data.appliedFrom, data.appliedTo)} />
        <Stat label="Nota" value={`${s.purchaseCount}`} />
        <Stat label="Bahan" value={`${s.ingredientCount}`} />
        <Stat label="Supplier" value={`${s.supplierCount}`} />
        <Stat label="Rata-rata / nota" value={formatRupiah(s.avgPerPurchase)} />
        <Stat
          label={`Rata-rata / hari belanja (${s.activeDays} hari)`}
          value={formatRupiah(s.avgPerActiveDay)}
        />
      </dl>

      {s.unpaidTotal > 0 && (
        <p className="text-sm text-neutral-700">
          <span className="font-semibold text-warning-500">
            {formatRupiah(s.unpaidTotal)}
          </span>{" "}
          dari total ini belum dibayar (masih hutang ke supplier).
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </div>
  );
}

/**
 * Satu batang penuh, bukan lima kartu. Bentuknya sendiri sudah menyampaikan
 * "ini pembagian dari satu kue". Chip di bawahnya bukan legenda pasif: klik =
 * saring ke section itu, klik lagi = lepas.
 */
function SectionComposition({
  data,
  activeSection,
  onPick,
}: {
  data: SpendRecapResult;
  activeSection: SpendSection | "all";
  onPick: (s: SpendSection) => void;
}) {
  const rows = data.bySection.filter((r) => r.amount > 0);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100">
        {rows.map((r) => (
          <div
            key={r.key}
            className="h-full transition-opacity"
            style={{
              width: `${Math.max(r.share * 100, 0.5)}%`,
              backgroundColor: SECTION_COLOR[r.key as SpendSection],
              opacity:
                activeSection === "all" || activeSection === r.key ? 1 : 0.28,
            }}
            title={`${r.label}: ${formatRupiah(r.amount)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const active = activeSection === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onPick(r.key as SpendSection)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors touch:py-2",
                active
                  ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: SECTION_COLOR[r.key as SpendSection] }}
                aria-hidden
              />
              <span className="font-medium">{r.label}</span>
              <span className="font-mono tabular-nums text-neutral-600">
                {formatRupiah(r.amount)}
              </span>
              <span className="text-xs text-neutral-500">{sharePct(r.share)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Belanja itu kejadian yang terpisah-pisah, jadi batang, bukan garis. */
function TrendChart({ data }: { data: SpendRecapResult }) {
  const byDay = data.summary.rangeDays <= 62;
  const series = byDay ? data.byDate : data.byMonth;
  if (series.length < 2) return null;

  const chartData = series.map((r) => ({
    key: r.key,
    label: r.label,
    amount: r.amount,
    purchaseCount: r.purchaseCount,
  }));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-mahakan-green-900">
          {byDay ? "Belanja per hari" : "Belanja per bulan"}
        </h3>
        <p className="text-xs text-neutral-500">
          {byDay ? "Hari tanpa batang berarti tidak ada barang masuk" : ""}
        </p>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e5e3db" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#6d685c" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e3db" }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6d685c" }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => compactRupiah(v)}
            />
            <RechartsTooltip
              cursor={{ fill: "#f2f1ec" }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #e5e3db",
                fontSize: 12,
              }}
              formatter={(v) => [formatRupiah(Number(v)), "Belanja"] as [string, string]}
            />
            <Bar dataKey="amount" fill="#3d7557" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ========================================================================== */

function BreakdownPanel(props: {
  data: SpendRecapResult;
  dimension: SpendDimension;
  onDimension: (d: SpendDimension) => void;
  rows: SpendGroupRow[];
  visibleRows: SpendGroupRow[];
  detailToken: string;
  expandAll: boolean;
  onExpandAll: () => void;
  sortMode: SortMode;
  onSortMode: (m: SortMode) => void;
  onExportSummary: () => void;
  onExportDetail: () => void;
  requestDetail: (key: string) => Promise<SpendDetailResult>;
}) {
  const { data, rows, visibleRows } = props;
  const maxAmount = rows.reduce((m, r) => (r.amount > m ? r.amount : m), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-mahakan-green-900">
            Rincian belanja
          </h3>
          <div
            role="group"
            aria-label="Rincikan per"
            className="inline-flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1"
          >
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={props.dimension === d}
                onClick={() => props.onDimension(d)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors touch:py-2",
                  props.dimension === d
                    ? "bg-white text-mahakan-green-900 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900",
                )}
              >
                {SPEND_DIMENSION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Select
            label="Urutkan"
            size="sm"
            value={props.sortMode}
            onValueChange={(v) => props.onSortMode(v as SortMode)}
            options={SORT_OPTIONS}
            className="min-w-[10rem]"
          />
          <Button variant="secondary" onClick={props.onExportSummary}>
            <Download className="size-4" aria-hidden /> Ringkasan
          </Button>
          <Button variant="secondary" onClick={props.onExportDetail}>
            <Download className="size-4" aria-hidden /> Rincian
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyCard
          title="Belum ada belanja di rentang ini"
          description="Ganti rentang tanggal, atau longgarkan filternya. Pembelian yang dibatalkan dan PO yang barangnya belum diterima memang tidak dihitung di sini."
        />
      ) : (
        <div className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {visibleRows.map((row) => (
            <BreakdownRow
              key={`${props.detailToken}|${props.dimension}|${row.key}`}
              row={row}
              maxAmount={maxAmount}
              dimension={props.dimension}
              requestDetail={props.requestDetail}
            />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-50 px-4 py-3">
            <span className="text-sm font-semibold text-neutral-800">
              Total {rows.length} {SPEND_DIMENSION_LABELS[props.dimension].toLowerCase()}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-mahakan-green-900">
              {formatRupiah(data.summary.total)}
            </span>
          </div>
        </div>
      )}

      {!props.expandAll && rows.length > visibleRows.length && (
        <button
          type="button"
          onClick={props.onExpandAll}
          className="text-sm font-medium text-mahakan-green-700 underline underline-offset-2 hover:text-mahakan-green-900"
        >
          Tampilkan {rows.length - visibleRows.length} baris lainnya
        </button>
      )}
    </section>
  );
}

/**
 * Baris rincian yang bisa dibuka di tempat. Sengaja BUKAN modal: angka rekap
 * hanya dipercaya kalau owner bisa langsung melihat nota di baliknya tanpa
 * kehilangan tempatnya di daftar.
 */
function BreakdownRow({
  row,
  maxAmount,
  dimension,
  requestDetail,
}: {
  row: SpendGroupRow;
  maxAmount: number;
  dimension: SpendDimension;
  requestDetail: (key: string) => Promise<SpendDetailResult>;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<SpendLine[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  /* Sekali diambil, tutup-buka lagi tidak memanggil server ulang. Aman karena
   * komponen ini di-key oleh identitas data: begitu filter atau rentang
   * berubah, barisnya lahir baru dan cache-nya ikut hilang. */
  const fetched = useRef(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || fetched.current) return;
    setDetailLoading(true);
    try {
      const res = await requestDetail(row.key);
      if (isOk(res)) {
        setLines(res.data.lines);
        setTruncated(res.data.truncated);
        fetched.current = true;
      } else {
        toast.error(res.error.message);
        setOpen(false);
      }
    } catch {
      toast.error("Gagal memuat rincian");
      setOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const barWidth = maxAmount > 0 ? (row.amount / maxAmount) * 100 : 0;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-neutral-50 touch:py-4"
      >
        <span className="text-neutral-400" aria-hidden>
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate font-medium text-neutral-900">
              {row.label}
            </span>
            {row.sublabel && (
              <span className="text-xs text-neutral-500">{row.sublabel}</span>
            )}
          </span>
          <span className="mt-1.5 block h-1.5 w-full max-w-md overflow-hidden rounded-full bg-neutral-100">
            <span
              className="block h-full rounded-full bg-mahakan-green-500"
              style={{ width: `${Math.max(barWidth, 1)}%` }}
            />
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-neutral-500">
            {row.qty !== null && row.unit && (
              <span>
                {formatQty(row.qty)} {row.unit}
                {row.avgUnitCost !== null && (
                  <> ({formatRupiah(row.avgUnitCost)} / {row.unit})</>
                )}
              </span>
            )}
            <span>
              {row.purchaseCount} nota
              {dimension !== "date" && dimension !== "month" && (
                <>, terakhir {formatDayLabel(row.lastDate)}</>
              )}
            </span>
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm font-semibold tabular-nums text-neutral-900">
            {formatRupiah(row.amount)}
          </span>
          <span className="block text-xs text-neutral-500">
            {sharePct(row.share)}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3">
          {detailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : !lines || lines.length === 0 ? (
            <p className="text-sm text-neutral-600">Tidak ada baris.</p>
          ) : (
            <>
              <ul className="divide-y divide-neutral-200">
                {lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs text-neutral-500 tabular-nums">
                        {formatDayLabel(l.date)}
                      </span>
                      <span className="font-medium text-neutral-900">
                        {l.ingredientName}
                      </span>
                      <span className="text-xs text-neutral-600">
                        {formatQty(l.qty)} {l.unit}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {l.supplierName ?? "Tanpa supplier"}
                        {l.invoiceNo ? ` · ${l.invoiceNo}` : ""}
                      </span>
                      {l.paymentStatus === "pending_payment" && (
                        <Badge variant="warning">Belum lunas</Badge>
                      )}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-neutral-900">
                      {formatRupiah(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              {truncated && (
                <p className="pt-2 text-xs text-neutral-500">
                  Hanya {lines.length} baris pertama yang ditampilkan. Pakai
                  ekspor Rincian untuk data lengkap.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Hal-hal yang harus owner tahu supaya angkanya tidak salah dibaca. */
function Footnotes({ data }: { data: SpendRecapResult }) {
  const notes: string[] = [];
  notes.push(
    data.dateBasis === "receipt"
      ? "Belanja ditaruh pada tanggal barang diterima, sama seperti jurnal dan Laba Rugi."
      : "Belanja ditaruh pada tanggal nota, jadi angkanya bisa berbeda dari Laba Rugi bulan itu.",
  );
  notes.push(
    "Pembelian yang dibatalkan tidak dihitung. Nilai satu baris memakai Total Bayar dari nota.",
  );
  if (data.cutoffApplied) {
    notes.push(
      `Batas buku aktif: data sebelum ${formatDayLabel(data.cutoffApplied)} disembunyikan.`,
    );
  }
  if (data.truncated) {
    notes.push(
      "Baris yang diambil kena batas maksimum. Persempit rentang tanggal supaya totalnya utuh.",
    );
  }

  return (
    <section className="space-y-3 border-t border-neutral-200 pt-4">
      {data.pendingOrders.count > 0 && (
        <p className="text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">
            {data.pendingOrders.count} PO senilai{" "}
            {formatRupiah(data.pendingOrders.amount)}
          </span>{" "}
          sudah dipesan tapi barangnya belum diterima, jadi belum masuk rekap
          ini. Cek tab PO untuk menindaklanjuti.
        </p>
      )}
      <ul className="space-y-1 text-xs text-neutral-500">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
