"use client";

/**
 * Sesi AE-192 — Modul "Masuk Bahan".
 *
 * Menjawab kebutuhan owner: melihat bahan baku masuk tanggal berapa saja, dan
 * memastikan setiap pembelian/pembayaran SUDAH tercatat di sistem. Karena itu
 * layar ini tidak menampilkan pergerakan stok (di mode periodic pergerakan
 * memang tidak menambah stok), melainkan PENERIMAAN BARANG: GR + pembelian
 * instan, lengkap dengan tanggal nota, tanggal input, status bayar, dan
 * daftar hari yang KOSONG (kandidat nota yang belum diinput).
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CalendarX,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Filter,
  PackageCheck,
  RefreshCw,
  Wallet,
} from "lucide-react";
import Papa from "papaparse";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  DatePicker,
  EmptyCard,
  Select,
  Skeleton,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  isOk,
  listIngredients,
  listIngredientIntake,
  entryLagDays,
  findMissingDays,
  groupIntakeByDate,
  groupIntakeByIngredient,
  isLateEntry,
  isOverdue,
  summarizeIntake,
  LATE_ENTRY_DAYS,
  type Ingredient,
  type IntakeLine,
  type PendingOrder,
} from "@/features/inventory";
import { isOk as isSupplierOk, listSuppliers } from "@/features/suppliers";
import type { Supplier } from "@/features/suppliers";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { displayUnit } from "@/lib/unit-conversion";
import { monthStartJakarta, todayJakarta } from "@/lib/tz";
import { downloadCsv } from "../reports/menu-engineering-csv";

type ViewMode = "by_date" | "by_ingredient";
type PaymentFilter = "all" | "paid" | "unpaid";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer_bca: "Transfer BCA",
  transfer_bri: "Transfer BRI",
  transfer_other: "Transfer lain",
  top: "TOP (hutang)",
};

function formatQty(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);
}

function formatTanggal(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTanggalPendek(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** Kalimat jeda input — inti verifikasi "sudah dimasukkan atau belum". */
function lagLabel(line: IntakeLine): string {
  const lag = entryLagDays(line);
  if (lag <= 0) return "Diinput hari itu juga";
  if (lag === 1) return "Diinput 1 hari setelahnya";
  return `Diinput ${lag} hari setelahnya`;
}

export function IngredientIntakeView() {
  const { session } = useSession();
  const role = session?.user.role;
  const canSeeCost = role ? hasPermission(role, "inventory.cost.view") : false;

  const today = todayJakarta();
  const [from, setFrom] = useState(monthStartJakarta(today));
  const [to, setTo] = useState(today);
  const [ingredientFilter, setIngredientFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [mode, setMode] = useState<ViewMode>("by_date");

  const [lines, setLines] = useState<IntakeLine[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listIngredients({ activeOnly: false }).then((res) => {
      if (!cancelled && isOk(res)) setIngredients(res.data.items);
    });
    void listSuppliers({ activeOnly: false }).then((res) => {
      if (!cancelled && isSupplierOk(res)) setSuppliers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await listIngredientIntake({
        dateFrom: from,
        dateTo: to,
        ingredientId: ingredientFilter === "all" ? undefined : ingredientFilter,
        supplierId: supplierFilter === "all" ? undefined : supplierFilter,
        paymentStatus: paymentFilter,
      });
      if (cancelled) return;
      if (isOk(res)) {
        setLines(res.data.lines);
        setPendingOrders(res.data.pendingOrders);
        setTruncated(res.data.truncated);
        setExpanded(new Set());
      } else {
        toast.error(res.error.message);
        setLines([]);
        setPendingOrders([]);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, from, to, ingredientFilter, supplierFilter, paymentFilter]);

  const summary = useMemo(() => summarizeIntake(lines, today), [lines, today]);
  const dayGroups = useMemo(() => groupIntakeByDate(lines), [lines]);
  const ingredientGroups = useMemo(
    () => groupIntakeByIngredient(lines),
    [lines],
  );

  /* Hari kosong hanya bermakna kalau tidak sedang memfilter satu bahan /
   * supplier tertentu — kalau difilter, "kosong" cuma berarti bahan itu tidak
   * dibeli hari itu, bukan nota yang belum diinput. */
  const gapMeaningful =
    ingredientFilter === "all" &&
    supplierFilter === "all" &&
    paymentFilter === "all";
  const missingDays = useMemo(() => {
    if (!gapMeaningful) return [];
    const capTo = to > today ? today : to;
    return findMissingDays(
      from,
      capTo,
      dayGroups.map((g) => g.date),
    );
  }, [gapMeaningful, from, to, today, dayGroups]);

  const lateLines = useMemo(() => lines.filter(isLateEntry), [lines]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onExportCsv() {
    if (lines.length === 0) {
      toast.info("Tidak ada data untuk diexport");
      return;
    }
    const rows = lines.map((l) => {
      const row: Record<string, string | number> = {
        "Tanggal Masuk": l.receiptDate,
        "Tanggal Nota": l.purchaseDate,
        Bahan: l.ingredientName,
        Qty: l.qty,
        Satuan: displayUnit(l.unit),
        Supplier: l.supplierName ?? "",
        "No Nota": l.invoiceNo ?? "",
        "Cara Bayar": PAYMENT_LABELS[l.paymentMethod] ?? l.paymentMethod,
        "Status Bayar":
          l.paymentStatus === "paid" ? "Lunas" : "Belum lunas",
        "Jatuh Tempo": l.dueDate ?? "",
        "Diinput Oleh": l.enteredByName ?? "",
        "Jeda Input (hari)": entryLagDays(l),
      };
      if (canSeeCost) {
        row["Harga Satuan"] = l.unitCost;
        row["Total (Rp)"] = l.totalCost;
      }
      return row;
    });
    downloadCsv(
      `masuk-bahan-${from}-${to}.csv`,
      Papa.unparse(rows, { newline: "\n" }),
    );
    toast.success(`Export ${rows.length} baris`);
  }

  const rangeDays = useMemo(() => {
    const capTo = to > today ? today : to;
    const a = new Date(`${from}T00:00:00Z`).getTime();
    const b = new Date(`${capTo}T00:00:00Z`).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86_400_000) + 1;
  }, [from, to, today]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Masuk Bahan
          </h2>
          <p className="max-w-2xl text-xs text-neutral-500">
            Riwayat bahan baku yang diterima — tanggal masuk, dari supplier
            mana, sudah dibayar atau belum, dan kapan nota-nya diinput ke
            sistem. Pakai daftar “hari tanpa catatan” di bawah untuk mengecek
            nota mana yang belum dimasukkan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            disabled={loading || lines.length === 0}
          >
            <Download className="size-4" aria-hidden /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 pb-1 text-sm font-medium text-neutral-700">
            <Filter className="size-4" aria-hidden /> Filter
          </div>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <DatePicker
              label="Dari Tanggal"
              value={from}
              maxDate={to}
              onChange={(v) => setFrom(v ?? "")}
              clearable={false}
            />
            <DatePicker
              label="Sampai Tanggal"
              value={to}
              minDate={from}
              onChange={(v) => setTo(v ?? "")}
              clearable={false}
            />
            <Combobox
              label="Bahan"
              placeholder="Semua bahan"
              searchPlaceholder="Cari bahan…"
              clearable
              groups={[
                {
                  label: "",
                  options: ingredients.map((i) => ({
                    value: i.id,
                    label: i.name,
                    hint: displayUnit(i.unit),
                    keywords: [i.unit],
                  })),
                } satisfies ComboboxGroup,
              ]}
              value={ingredientFilter === "all" ? null : ingredientFilter}
              onChange={(v) => setIngredientFilter(v ?? "all")}
            />
            <Combobox
              label="Supplier"
              placeholder="Semua supplier"
              searchPlaceholder="Cari supplier…"
              clearable
              groups={[
                {
                  label: "",
                  options: suppliers.map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                } satisfies ComboboxGroup,
              ]}
              value={supplierFilter === "all" ? null : supplierFilter}
              onChange={(v) => setSupplierFilter(v ?? "all")}
            />
            <Select
              label="Status Bayar"
              options={[
                { value: "all", label: "Semua" },
                { value: "unpaid", label: "Belum lunas" },
                { value: "paid", label: "Sudah lunas" },
              ]}
              value={paymentFilter}
              onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}
            />
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="space-y-2" role="status" aria-label="Memuat">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={PackageCheck}
              label="Nota masuk"
              value={`${summary.noteCount}`}
              hint={`${summary.lineCount} baris bahan · ${summary.ingredientCount} jenis`}
            />
            <StatTile
              icon={CalendarDays}
              label="Hari ada catatan"
              value={`${summary.daysWithData} / ${rangeDays}`}
              hint={
                gapMeaningful
                  ? `${missingDays.length} hari tanpa catatan`
                  : "Filter aktif — hari kosong tidak dihitung"
              }
              tone={
                gapMeaningful && missingDays.length > 0 ? "warning" : "neutral"
              }
            />
            {canSeeCost ? (
              <StatTile
                icon={Wallet}
                label="Nilai barang masuk"
                value={formatRupiah(summary.totalCost)}
                hint={
                  summary.unpaidNoteCount > 0
                    ? `${formatRupiah(summary.unpaidCost)} belum lunas (${summary.unpaidNoteCount} nota)`
                    : "Semua nota sudah lunas"
                }
                tone={summary.unpaidNoteCount > 0 ? "warning" : "neutral"}
              />
            ) : null}
            <StatTile
              icon={Clock}
              label="Nota telat diinput"
              value={`${summary.lateNoteCount}`}
              hint={`Jeda input > ${LATE_ENTRY_DAYS} hari dari tanggal masuk`}
              tone={summary.lateNoteCount > 0 ? "warning" : "neutral"}
            />
          </div>

          {truncated ? (
            <Card>
              <CardContent className="flex items-start gap-2 py-3 text-sm text-warning-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Data terlalu banyak untuk rentang ini — sebagian baris tidak
                ditampilkan. Persempit rentang tanggal.
              </CardContent>
            </Card>
          ) : null}

          {gapMeaningful && missingDays.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                  <CalendarX className="size-4 text-warning-600" aria-hidden />
                  {missingDays.length} hari tanpa catatan masuk bahan
                </div>
                <p className="text-xs text-neutral-500">
                  Tanggal-tanggal ini belum punya satu pun catatan penerimaan.
                  Cek tumpukan nota: kalau hari itu memang belanja, berarti
                  notanya belum dimasukkan ke sistem.
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5 pt-0">
                {missingDays.map((d) => (
                  <span
                    key={d}
                    className="rounded-md border border-warning-200 bg-warning-50 px-2 py-1 font-mono text-xs text-warning-700"
                  >
                    {formatTanggalPendek(d)}
                  </span>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {pendingOrders.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                  <ClipboardList
                    className="size-4 text-info-600"
                    aria-hidden
                  />
                  {pendingOrders.length} PO barangnya belum diterima penuh
                </div>
                <p className="text-xs text-neutral-500">
                  Sudah dipesan tapi penerimaannya (GR) belum dicatat. Kalau
                  barangnya sebenarnya sudah datang, catat GR-nya di menu
                  Purchasing supaya biaya & hutangnya ikut terhitung.
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {pendingOrders.map((po) => (
                  <div
                    key={po.purchaseId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-neutral-900">
                        {po.supplierName ?? "Pembelian langsung"}
                      </span>
                      <span className="ml-2 text-xs text-neutral-500">
                        {formatTanggal(po.purchaseDate)}
                        {po.invoiceNo ? ` · ${po.invoiceNo}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          po.receiptStatus === "partial" ? "warning" : "info"
                        }
                      >
                        {po.receiptStatus === "partial"
                          ? `Sebagian (${po.receivedItemCount}/${po.itemCount})`
                          : `Belum diterima (${po.itemCount} bahan)`}
                      </Badge>
                      {canSeeCost ? (
                        <span className="font-mono text-xs text-neutral-700">
                          {formatRupiah(po.totalAmount)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={mode === "by_date" ? "primary" : "outline"}
              size="sm"
              onClick={() => setMode("by_date")}
            >
              Per Tanggal
            </Button>
            <Button
              variant={mode === "by_ingredient" ? "primary" : "outline"}
              size="sm"
              onClick={() => setMode("by_ingredient")}
            >
              Per Bahan
            </Button>
            {lateLines.length > 0 ? (
              <span className="ml-auto text-xs text-neutral-500">
                Baris bertanda{" "}
                <Badge variant="warning">telat input</Badge> dicatat lebih dari{" "}
                {LATE_ENTRY_DAYS} hari setelah barang masuk.
              </span>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <EmptyCard
              icon={PackageCheck}
              title="Belum ada bahan masuk pada rentang ini"
              description="Kalau seharusnya ada belanja di periode ini, berarti notanya belum dimasukkan ke sistem. Catat lewat menu Purchasing → Pembelian."
            />
          ) : mode === "by_date" ? (
            <div className="space-y-2">
              {dayGroups.map((g) => {
                const open = expanded.has(g.date);
                return (
                  <Card key={g.date}>
                    <button
                      type="button"
                      onClick={() => toggle(g.date)}
                      aria-expanded={open}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50"
                    >
                      <div className="flex items-center gap-2">
                        {open ? (
                          <ChevronDown
                            className="size-4 text-neutral-400"
                            aria-hidden
                          />
                        ) : (
                          <ChevronRight
                            className="size-4 text-neutral-400"
                            aria-hidden
                          />
                        )}
                        <div>
                          <div className="font-medium text-neutral-900">
                            {formatTanggal(g.date)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {g.noteCount} nota · {g.ingredientCount} bahan ·{" "}
                            {g.supplierNames.join(", ")}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {g.maxLagDays > LATE_ENTRY_DAYS ? (
                          <Badge variant="warning">
                            telat input {g.maxLagDays} hari
                          </Badge>
                        ) : null}
                        {canSeeCost && g.unpaidCost > 0 ? (
                          <Badge variant="danger">
                            {formatRupiah(g.unpaidCost)} belum lunas
                          </Badge>
                        ) : null}
                        {canSeeCost ? (
                          <span className="font-mono text-sm font-semibold text-neutral-900">
                            {formatRupiah(g.totalCost)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {open ? (
                      <CardContent className="px-0 pt-0">
                        <LineTable
                          lines={g.lines}
                          canSeeCost={canSeeCost}
                          today={today}
                          showDate={false}
                        />
                      </CardContent>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {ingredientGroups.map((g) => {
                const open = expanded.has(g.ingredientId);
                return (
                  <Card key={g.ingredientId}>
                    <button
                      type="button"
                      onClick={() => toggle(g.ingredientId)}
                      aria-expanded={open}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50"
                    >
                      <div className="flex items-center gap-2">
                        {open ? (
                          <ChevronDown
                            className="size-4 text-neutral-400"
                            aria-hidden
                          />
                        ) : (
                          <ChevronRight
                            className="size-4 text-neutral-400"
                            aria-hidden
                          />
                        )}
                        <div>
                          <div className="font-medium text-neutral-900">
                            {g.ingredientName}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {g.lines.length}× masuk · total{" "}
                            {formatQty(g.totalQty)} {displayUnit(g.unit)} ·
                            terakhir {formatTanggal(g.lastDate)}
                          </div>
                        </div>
                      </div>
                      {canSeeCost ? (
                        <span className="font-mono text-sm font-semibold text-neutral-900">
                          {formatRupiah(g.totalCost)}
                        </span>
                      ) : null}
                    </button>
                    {open ? (
                      <CardContent className="px-0 pt-0">
                        <LineTable
                          lines={g.lines}
                          canSeeCost={canSeeCost}
                          today={today}
                          showDate
                        />
                      </CardContent>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: typeof PackageCheck;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          <Icon
            className={
              tone === "warning"
                ? "size-4 text-warning-600"
                : "size-4 text-neutral-400"
            }
            aria-hidden
          />
          {label}
        </div>
        <div
          className={
            tone === "warning"
              ? "text-xl font-bold text-warning-700"
              : "text-xl font-bold text-neutral-900"
          }
        >
          {value}
        </div>
        <div className="text-xs text-neutral-500">{hint}</div>
      </CardContent>
    </Card>
  );
}

function LineTable({
  lines,
  canSeeCost,
  today,
  showDate,
}: {
  lines: IntakeLine[];
  canSeeCost: boolean;
  today: string;
  showDate: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
          <tr>
            {showDate ? (
              <th className="px-4 py-2 text-left font-medium">Masuk</th>
            ) : null}
            <th className="px-4 py-2 text-left font-medium">Bahan</th>
            <th className="px-4 py-2 text-right font-medium">Qty</th>
            {canSeeCost ? (
              <>
                <th className="px-4 py-2 text-right font-medium">Harga</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </>
            ) : null}
            <th className="px-4 py-2 text-left font-medium">Supplier / Nota</th>
            <th className="px-4 py-2 text-left font-medium">Bayar</th>
            <th className="px-4 py-2 text-left font-medium">Input</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {lines.map((l) => {
            const overdue = isOverdue(l, today);
            const late = isLateEntry(l);
            return (
              <tr key={`${l.source}-${l.id}`} className="hover:bg-neutral-50">
                {showDate ? (
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">
                    {formatTanggal(l.receiptDate)}
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <span className="font-medium text-neutral-900">
                    {l.ingredientName}
                  </span>
                  {l.receiptDate !== l.purchaseDate ? (
                    <span className="ml-1 text-xs text-neutral-500">
                      (nota {formatTanggalPendek(l.purchaseDate)})
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono">
                  {formatQty(l.qty)}{" "}
                  <span className="text-xs text-neutral-500">
                    {displayUnit(l.unit)}
                  </span>
                </td>
                {canSeeCost ? (
                  <>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-neutral-700">
                      {formatRupiah(l.unitCost)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono">
                      {formatRupiah(l.totalCost)}
                    </td>
                  </>
                ) : null}
                <td className="px-4 py-3 text-xs text-neutral-700">
                  {l.supplierName ?? (
                    <span className="text-neutral-400">Tanpa supplier</span>
                  )}
                  {l.invoiceNo ? (
                    <span className="block text-neutral-500">
                      {l.invoiceNo}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">
                  {l.paymentStatus === "paid" ? (
                    <Badge variant="success">Lunas</Badge>
                  ) : (
                    <Badge variant={overdue ? "danger" : "warning"}>
                      {overdue ? "Lewat tempo" : "Belum lunas"}
                    </Badge>
                  )}
                  <span className="ml-1 text-neutral-500">
                    {PAYMENT_LABELS[l.paymentMethod] ?? l.paymentMethod}
                  </span>
                  {l.dueDate && l.paymentStatus !== "paid" ? (
                    <span className="block text-neutral-500">
                      jatuh tempo {formatTanggalPendek(l.dueDate)}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-700">
                  <span className="block">{l.enteredByName ?? "—"}</span>
                  <span
                    className={
                      late
                        ? "block font-medium text-warning-700"
                        : "block text-neutral-500"
                    }
                  >
                    {lagLabel(l)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
