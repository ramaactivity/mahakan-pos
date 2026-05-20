"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  Camera,
  CheckCircle2,
  Coins,
  Delete,
  ExternalLink,
  Eraser,
  Flame,
  Hammer,
  HandHelping,
  Heart,
  ImagePlus,
  ListTree,
  Loader2,
  PartyPopper,
  Pencil,
  RefreshCw,
  Scissors,
  Snowflake,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Skeleton,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  createExpense,
  createIncome,
  isOk,
  listExpenseCategories,
  listExpenses,
  listIncomes,
  listPendingEntryChanges,
  type Expense,
  type ExpenseCategory,
  type Income,
  type PendingEntryChangeWithMeta,
} from "@/features/cash";
import { ProposeEntryChangeModal } from "@/features/cash/components/ProposeEntryChangeModal";
import { formatRupiah } from "@/lib/format";
import { todayWibIso } from "@/features/cash/helpers";
import { formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type Mode = "expense" | "income";

/** Sesi AE-40 — quick-pick chip dengan keyword priority list buat
 *  match ke nama kategori (substring, case-insensitive). Fallback chain
 *  ke "Lain-lain" → kategori pertama. Owner Mahakan punya kategori
 *  generik (Belanja Bahan Baku, Listrik & Air, Gaji Harian, dll); chip
 *  di-design untuk auto-pilih kategori yang paling relevan supaya staff
 *  gak bingung pilih sendiri. */
interface QuickPick {
  label: string;
  description: string;
  icon: typeof Flame;
  /** Priority list — first match wins. Falls back ke "Lain-lain" kalau
   *  tidak match. Kosong = jangan auto-pilih kategori. */
  categoryKeywords?: string[];
}

const EXPENSE_QUICK_PICKS: QuickPick[] = [
  {
    label: "Gas LPG",
    description: "Beli gas LPG dapur",
    icon: Flame,
    categoryKeywords: ["belanja bahan", "lpg", "operasional"],
  },
  {
    label: "Ice Cube",
    description: "Beli es batu kristal",
    icon: Snowflake,
    categoryKeywords: ["belanja bahan", "es", "operasional"],
  },
  {
    label: "Galon Karyawan",
    description: "Refill galon air karyawan",
    icon: Wallet,
    categoryKeywords: ["listrik", "air", "galon"],
  },
  {
    label: "Galon Cleo",
    description: "Beli galon Cleo untuk produksi kopi",
    icon: Wallet,
    categoryKeywords: ["belanja bahan", "cleo", "air", "galon"],
  },
  {
    label: "Tukang Rumput",
    description: "Bayar tukang rumput",
    icon: Scissors,
    categoryKeywords: ["perawatan", "rumput", "kebersihan", "maintenance"],
  },
  {
    label: "Perbaikan",
    description: "Perbaikan peralatan / fasilitas",
    icon: Hammer,
    categoryKeywords: ["perawatan", "perbaikan", "maintenance", "service"],
  },
  {
    label: "Sumbangan",
    description: "Sumbangan / donasi",
    icon: Heart,
    categoryKeywords: ["sumbangan", "donasi", "lain"],
  },
  {
    label: "Lainnya",
    description: "",
    icon: ListTree,
    categoryKeywords: ["lain", "umum", "other"],
  },
];

const INCOME_QUICK_PICKS: QuickPick[] = [
  {
    label: "DP Event",
    description: "DP customer untuk event / private booking",
    icon: PartyPopper,
  },
  {
    label: "Tip Customer",
    description: "Tip customer masuk laci",
    icon: HandHelping,
  },
  {
    label: "Lainnya",
    description: "",
    icon: ListTree,
  },
];

const QUICK_AMOUNTS_EXPENSE: Array<{ label: string; value: string }> = [
  { label: "5rb", value: "5000" },
  { label: "10rb", value: "10000" },
  { label: "20rb", value: "20000" },
  { label: "50rb", value: "50000" },
  { label: "100rb", value: "100000" },
];

const QUICK_AMOUNTS_INCOME: Array<{ label: string; value: string }> = [
  { label: "50rb", value: "50000" },
  { label: "100rb", value: "100000" },
  { label: "200rb", value: "200000" },
  { label: "300rb", value: "300000" },
  { label: "500rb", value: "500000" },
];

/**
 * Sesi AE-40 redesign — Petty Cash 2-col layout untuk Galaxy A7 Lite
 * tablet (1340×800 landscape).
 *
 * Fix dari sesi AE-38:
 *   1. Kategori Cepat ↔ Kategori dropdown sekarang sync. Tap chip
 *      → auto-pilih kategori yang match (priority keyword), fallback
 *      ke "Lain-lain". Indicator visual ke dropdown supaya staff lihat.
 *   2. Layout 2-col: KIRI = chips + deskripsi + kategori + bukti foto
 *      (Drive). KANAN = hero amount + 5 quick amounts + numpad 3×4
 *      + tombol submit. Mirror pattern OpenShiftModal AE-2.
 *   3. Upload bukti transaksi reuse endpoint
 *      `/api/v1/expense-receipts/upload` (Google Drive auto-folder
 *      "STRUK PENGELUARAN/{YYYY}/{NN. MONTH}/"). Hanya untuk mode
 *      pengeluaran — pemasukan belum punya kolom + endpoint.
 */
export function PettyCashCard() {
  const [mode, setMode] = useState<Mode>("expense");
  const [description, setDescription] = useState("");
  /** Raw digit string (no separator). Formatted display via formatRupiah. */
  const [amountDigits, setAmountDigits] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<
    Array<{ kind: Mode; row: Expense | Income; ts: number }>
  >([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedOnce = useRef(false);
  const [recentFilter, setRecentFilter] = useState<Mode | "all">("all");
  const [activeChipLabel, setActiveChipLabel] = useState<string | null>(null);

  // Receipt upload (expense only — endpoint exists, income belum)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Sesi AE-67 Phase 1 — retroactive date picker.
   * Default = today (Jakarta). Boleh up to 3 hari ke belakang untuk handle
   * "staff lupa input kemarin / 2 hari lalu". Lebih jauh dari itu = harus
   * propose via approval (mencegah backdate abuse). */
  const [entryDate, setEntryDate] = useState<string>(() => todayWibIso());
  const isRetro = entryDate !== todayWibIso();

  // Sesi AE-67 Phase 2 — propose entry change modal state.
  const [proposeModal, setProposeModal] = useState<{
    open: boolean;
    mode: "edit" | "delete";
    entityType: "expense" | "income";
    entity: Expense | Income | null;
  }>({ open: false, mode: "edit", entityType: "expense", entity: null });

  // Sesi AE-67 — pending changes per entityId (map untuk fast lookup).
  const [pendingByEntityId, setPendingByEntityId] = useState<Map<string, PendingEntryChangeWithMeta>>(new Map());

  // Load categories once on mount + init categoryId ke "Lain-lain" (atau
  // first non-system) supaya staff gak perlu pilih manual buat case umum.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listExpenseCategories();
      if (cancelled) return;
      if (isOk(res)) {
        const items = res.data.items;
        setCategories(items);
        const visible = items.filter((c) => !c.isSystem);
        if (visible.length > 0) {
          const lainHit = visible.find((c) => /lain/i.test(c.name));
          setCategoryId((cur) => (cur === "" ? (lainHit?.id ?? visible[0]!.id) : cur));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load recent entries untuk entryDate yang dipilih.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasLoadedOnce.current) setLoadingRecent(true);
      /* Sesi AE-63 phase9 — filter sourceType='manual' + paymentMethod='cash'
       * supaya petty cash drawer view tidak ke-leak entries auto-generated
       * (payroll/purchase/refund) yang sumbernya bukan kas drawer.
       * Sesi AE-67 — date pakai entryDate (default today, bisa retro). */
      const [expRes, incRes, pecRes] = await Promise.all([
        listExpenses({
          from: entryDate,
          to: entryDate,
          limit: 50,
          sourceType: "manual",
          paymentMethod: "cash",
        }),
        listIncomes({
          from: entryDate,
          to: entryDate,
          limit: 50,
          paymentMethod: "cash",
        }),
        listPendingEntryChanges({ status: "pending_approval", limit: 100 }),
      ]);
      if (cancelled) return;
      const merged: Array<{
        kind: Mode;
        row: Expense | Income;
        ts: number;
      }> = [];
      if (isOk(expRes)) {
        for (const e of expRes.data.items) {
          merged.push({
            kind: "expense",
            row: e,
            ts: new Date(e.createdAt).getTime(),
          });
        }
      }
      if (isOk(incRes)) {
        for (const i of incRes.data.items) {
          merged.push({
            kind: "income",
            row: i,
            ts: new Date(i.createdAt).getTime(),
          });
        }
      }
      merged.sort((a, b) => b.ts - a.ts);
      setRecent(merged);
      if (isOk(pecRes)) {
        const map = new Map<string, PendingEntryChangeWithMeta>();
        for (const pec of pecRes.data) {
          map.set(pec.entityId, pec);
        }
        setPendingByEntityId(map);
      }
      setLoadingRecent(false);
      hasLoadedOnce.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, entryDate]);

  const parsedAmount = amountDigits.length === 0 ? 0 : Number(amountDigits);

  const dashboard = useMemo(() => {
    let outSum = 0;
    let inSum = 0;
    let outCount = 0;
    let inCount = 0;
    for (const r of recent) {
      if (r.kind === "expense") {
        outSum += r.row.amount;
        outCount++;
      } else {
        inSum += r.row.amount;
        inCount++;
      }
    }
    return {
      outSum,
      inSum,
      outCount,
      inCount,
      net: inSum - outSum,
      total: outCount + inCount,
    };
  }, [recent]);

  const filteredRecent = useMemo(() => {
    if (recentFilter === "all") return recent;
    return recent.filter((r) => r.kind === recentFilter);
  }, [recent, recentFilter]);

  const categoryById = useMemo(() => {
    const m = new Map<string, ExpenseCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // User-visible categories (hide system, e.g. Refund)
  const visibleCategories = useMemo(
    () => categories.filter((c) => !c.isSystem),
    [categories],
  );

  /** Pick best-matching category id berdasarkan priority keywords.
   *  Fallback chain: keyword match → kategori "Lain-lain" → first. */
  function pickCategoryId(keywords: string[] | undefined): string | null {
    const lcCats = visibleCategories.map((c) => ({
      id: c.id,
      lc: c.name.toLowerCase(),
    }));
    if (keywords && keywords.length > 0) {
      for (const kw of keywords) {
        const hit = lcCats.find((c) => c.lc.includes(kw.toLowerCase()));
        if (hit) return hit.id;
      }
    }
    const lainHit = lcCats.find((c) => /lain/.test(c.lc));
    if (lainHit) return lainHit.id;
    return visibleCategories[0]?.id ?? null;
  }

  function applyQuickPick(pick: QuickPick) {
    setActiveChipLabel(pick.label);
    if (pick.description) setDescription(pick.description);
    if (mode === "expense") {
      const id = pickCategoryId(pick.categoryKeywords);
      if (id) setCategoryId(id);
    }
  }

  // Numpad helpers
  function appendDigit(d: string) {
    setAmountDigits((prev) => {
      const next = (prev + d).replace(/^0+(?=\d)/, "");
      // Cap at Rp 999.999.999 (9 digits)
      return next.slice(0, 9);
    });
  }
  function backspace() {
    setAmountDigits((prev) => prev.slice(0, -1));
  }
  function clearAmount() {
    setAmountDigits("");
  }
  function setQuickAmount(value: string) {
    setAmountDigits(value);
  }

  // Receipt upload
  async function handleReceiptUpload(file: File) {
    if (uploadingReceipt) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Foto bukti maksimal 5 MB");
      return;
    }
    setUploadingReceipt(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("expenseDate", entryDate);
      const res = await fetch("/api/v1/expense-receipts/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { success: true; data: { url: string; folderPath: string } }
        | { success: false; error: { code: string; message: string } };
      if (!json.success) {
        throw new Error(json.error.message);
      }
      setReceiptUrl(json.data.url);
      toast.success(`Bukti tersimpan di Drive · ${json.data.folderPath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload gagal");
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resetForm() {
    setDescription("");
    setAmountDigits("");
    setActiveChipLabel(null);
    setReceiptUrl(null);
    // Re-pick default category (Lain-lain or first)
    const defId = pickCategoryId(undefined);
    if (defId) setCategoryId(defId);
  }

  async function onSubmit() {
    /* Sesi AE-49 — defense against double-submit race. setSubmitting di
     * awal supaya block re-entry sebelum validation/network call selesai.
     * Sebelumnya: setSubmitting di tengah → window race kalau user double-tap. */
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    if (description.trim().length === 0) {
      setError("Deskripsi wajib diisi");
      setSubmitting(false);
      return;
    }
    if (parsedAmount <= 0) {
      setError("Nominal harus lebih dari nol");
      setSubmitting(false);
      return;
    }
    if (mode === "expense" && categoryId.length === 0) {
      setError("Pilih kategori untuk pengeluaran");
      setSubmitting(false);
      return;
    }

    if (mode === "expense") {
      const res = await createExpense({
        expenseDate: entryDate,
        categoryId,
        description: description.trim(),
        amount: parsedAmount,
        paymentMethod: "cash",
        receiptImageUrl: receiptUrl,
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success(
        isRetro
          ? `Pengeluaran ${formatRupiah(parsedAmount)} dicatat ke ${entryDate}`
          : `Pengeluaran ${formatRupiah(parsedAmount)} dicatat`,
      );
    } else {
      const res = await createIncome({
        incomeDate: entryDate,
        description: description.trim(),
        amount: parsedAmount,
        paymentMethod: "cash",
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success(
        isRetro
          ? `Pemasukan ${formatRupiah(parsedAmount)} dicatat ke ${entryDate}`
          : `Pemasukan ${formatRupiah(parsedAmount)} dicatat`,
      );
    }

    resetForm();
    setRefreshKey((k) => k + 1);
  }

  /** Min date selectable: 3 hari sebelum hari ini (mencegah backdate abuse). */
  const minDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10);
  })();
  const maxDate = todayWibIso();

  const quickPicks = mode === "expense" ? EXPENSE_QUICK_PICKS : INCOME_QUICK_PICKS;
  const quickAmounts =
    mode === "expense" ? QUICK_AMOUNTS_EXPENSE : QUICK_AMOUNTS_INCOME;
  const selectedCategory = categoryId ? categoryById.get(categoryId) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-5 text-mahakan-green-700" aria-hidden />
              Petty Cash
            </CardTitle>
            <CardDescription>
              Catat pengeluaran / pemasukan kas sehari-hari (gas, es batu,
              galon, tip, DP event, dll). Tap kategori cepat untuk auto-pilih
              deskripsi + kategori, lalu masukkan nominal di numpad. Otomatis
              terangkum saat tutup shift.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>

        {/* Dashboard cards */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Pengeluaran Hari Ini"
            value={formatRupiah(dashboard.outSum)}
            sublabel={`${dashboard.outCount}× entri`}
            tone="danger"
            icon={<ArrowDownCircle className="size-4" />}
          />
          <StatCard
            label="Pemasukan Hari Ini"
            value={formatRupiah(dashboard.inSum)}
            sublabel={`${dashboard.inCount}× entri`}
            tone="success"
            icon={<ArrowUpCircle className="size-4" />}
          />
          <StatCard
            label="Net Petty Cash"
            value={formatRupiah(dashboard.net)}
            sublabel={dashboard.net >= 0 ? "Surplus" : "Defisit"}
            tone={dashboard.net >= 0 ? "success" : "danger"}
            icon={<TrendingUp className="size-4" />}
          />
          <StatCard
            label="Total Entri"
            value={String(dashboard.total)}
            sublabel="Hari ini"
            tone="neutral"
            icon={<Coins className="size-4" />}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-4 pb-6 sm:px-6">
        {/* Mode toggle (full width) */}
        <div
          role="radiogroup"
          aria-label="Tipe entri petty cash"
          className="grid grid-cols-2 gap-2"
        >
          {(
            [
              {
                value: "expense" as const,
                label: "Pengeluaran",
                Icon: ArrowDownCircle,
              },
              {
                value: "income" as const,
                label: "Pemasukan",
                Icon: ArrowUpCircle,
              },
            ]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={mode === opt.value}
              onClick={() => {
                setMode(opt.value);
                resetForm();
              }}
              disabled={submitting}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-semibold transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                mode === opt.value
                  ? opt.value === "expense"
                    ? "border-danger-500 bg-danger-100/60 text-danger-500"
                    : "border-success-500 bg-success-100/60 text-success-500"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
              )}
            >
              <opt.Icon className="size-5" aria-hidden />
              {opt.label}
            </button>
          ))}
        </div>

        {/* Sesi AE-67 Phase 1 — Date picker untuk retroactive entry.
         * Default = today. Allow up to 3 hari ke belakang (mencegah backdate
         * abuse, sekaligus solusi "lupa input kemarin"). Highlight banner
         * kalau date != today. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
            <Calendar className="size-4" aria-hidden />
            Tanggal Entri
          </label>
          <input
            type="date"
            value={entryDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
          />
          {isRetro ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-warning-300 bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-700">
              ⚠ Retro · catat ke tanggal lampau
            </span>
          ) : null}
          {entryDate !== todayWibIso() ? (
            <button
              type="button"
              onClick={() => setEntryDate(todayWibIso())}
              className="ml-auto text-[11px] font-medium text-neutral-500 hover:text-mahakan-green-700"
            >
              Reset ke hari ini
            </button>
          ) : null}
        </div>

        {/* 2-col layout: KIRI = form, KANAN = numpad + amount */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ============ KIRI: Form ============ */}
          <section className="space-y-4">
            {/* Quick-pick chips */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Kategori Cepat
                </p>
                {activeChipLabel ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveChipLabel(null);
                      setDescription("");
                    }}
                    className="text-[11px] font-medium text-neutral-500 hover:text-danger-500"
                  >
                    <Eraser className="mr-0.5 inline size-3" /> Bersihkan
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {quickPicks.map((q) => {
                  const Icon = q.icon;
                  const active = activeChipLabel === q.label;
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => applyQuickPick(q)}
                      disabled={submitting}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border-2 p-2.5 text-xs font-medium transition-all",
                        active
                          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900 shadow-sm"
                          : "border-neutral-200 bg-white text-neutral-700 hover:border-mahakan-green-700/50 hover:bg-mahakan-green-50/40",
                        submitting && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-5",
                          active ? "text-mahakan-green-700" : "text-neutral-500",
                        )}
                        aria-hidden
                      />
                      <span className="text-center leading-tight">
                        {q.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description */}
            <Input
              label="Deskripsi"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 200))}
              placeholder={
                mode === "expense"
                  ? "Mis. beli es batu 3 pack, refill galon Cleo"
                  : "Mis. DP event komunitas X tgl 20"
              }
              disabled={submitting}
              required
              hint={
                description.length > 0
                  ? `${description.length}/200 karakter`
                  : undefined
              }
            />

            {/* Category (expense only) */}
            {mode === "expense" ? (
              visibleCategories.length === 0 ? (
                <div className="rounded-lg border border-warning-500/40 bg-warning-100/40 px-3 py-2 text-xs text-warning-500">
                  ⚠️ Belum ada kategori pengeluaran. Owner / Manager perlu
                  set di Back Office → Cash → Kategori dulu, supaya petty
                  cash bisa dicatat. Saran: <em>Belanja Bahan Baku</em>,{" "}
                  <em>Listrik & Air</em>, <em>Perawatan Alat</em>,{" "}
                  <em>Lain-lain</em>.
                </div>
              ) : (
                <div className="space-y-1">
                  <Select
                    label="Kategori"
                    value={categoryId || undefined}
                    onValueChange={(v) => setCategoryId(v)}
                    disabled={submitting}
                    placeholder="Pilih kategori"
                    options={visibleCategories.map<SelectOption>((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                  {activeChipLabel && selectedCategory ? (
                    <p className="text-[11px] text-mahakan-green-900">
                      ✓ Otomatis dipilih dari chip{" "}
                      <strong>{activeChipLabel}</strong> →{" "}
                      <strong>{selectedCategory.name}</strong>. Bisa diubah
                      manual kalau perlu.
                    </p>
                  ) : null}
                </div>
              )
            ) : null}

            {/* Receipt upload (expense only) */}
            {mode === "expense" ? (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-neutral-900">
                  Bukti Transaksi (opsional)
                </label>
                {receiptUrl ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50 px-3 py-2">
                    <a
                      href={receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-mahakan-green-900 hover:underline"
                    >
                      <Camera className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">
                        Bukti tersimpan di Drive — klik untuk lihat
                      </span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                    <button
                      type="button"
                      onClick={() => setReceiptUrl(null)}
                      disabled={submitting || uploadingReceipt}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                      aria-label="Hapus bukti dari form (file tetap di Drive)"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 px-3 py-2.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleReceiptUpload(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingReceipt || submitting}
                    >
                      {uploadingReceipt ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />{" "}
                          Mengupload…
                        </>
                      ) : (
                        <>
                          <ImagePlus className="size-4" /> Upload Foto Struk
                        </>
                      )}
                    </Button>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      JPG / PNG / WebP / PDF, max 5 MB. Disimpan otomatis ke
                      Google Drive folder <em>STRUK PENGELUARAN</em>.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {/* ============ KANAN: Hero amount + numpad ============ */}
          <section className="space-y-4">
            {/* Hero amount */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Nominal
                </span>
                <span className="text-[11px] text-neutral-500">
                  Tap angka di numpad
                </span>
              </div>
              <div
                className={cn(
                  "flex h-20 items-center justify-end rounded-xl border-2 px-5 font-mono text-3xl font-bold tabular-nums transition-all sm:text-4xl",
                  parsedAmount > 0
                    ? mode === "expense"
                      ? "border-danger-500 bg-danger-100/40 text-danger-500"
                      : "border-success-500 bg-success-100/40 text-success-500"
                    : "border-neutral-200 bg-neutral-50 text-neutral-400",
                )}
              >
                {formatRupiah(parsedAmount)}
              </div>
            </div>

            {/* Quick amounts */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Nominal Cepat
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {quickAmounts.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setQuickAmount(q.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setQuickAmount(q.value);
                      }
                    }}
                    style={{ touchAction: "manipulation" }}
                    disabled={submitting}
                    className={cn(
                      "rounded-lg border-2 py-1.5 text-sm font-bold transition-all active:scale-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      amountDigits === q.value
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Numpad 3×4 */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Numpad
              </p>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <NumKey
                    key={d}
                    label={d}
                    onPress={() => appendDigit(d)}
                    disabled={submitting}
                  />
                ))}
                <NumKey
                  label="C"
                  onPress={clearAmount}
                  disabled={submitting}
                  variant="muted"
                />
                <NumKey
                  label="0"
                  onPress={() => appendDigit("0")}
                  disabled={submitting}
                />
                <NumKey
                  label={<Delete className="size-5" aria-hidden />}
                  onPress={backspace}
                  disabled={submitting}
                  variant="muted"
                  ariaLabel="Hapus angka terakhir"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Error banner */}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-danger-300 bg-danger-100/40 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}

        {/* Submit button (full width) */}
        <Button
          type="button"
          onClick={onSubmit}
          loading={submitting}
          disabled={
            submitting ||
            (mode === "expense" && visibleCategories.length === 0)
          }
          fullWidth
          className={cn(
            "h-14 text-base font-semibold",
            mode === "expense"
              ? "!bg-danger-500 hover:!bg-danger-700"
              : "!bg-success-500 hover:!bg-success-500",
          )}
        >
          {submitting
            ? "Memproses…"
            : `Catat ${mode === "expense" ? "Pengeluaran" : "Pemasukan"}${
                parsedAmount > 0 ? ` ${formatRupiah(parsedAmount)}` : ""
              }`}
        </Button>

        {/* Today's recent list */}
        <div className="border-t border-neutral-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-neutral-900">
              Riwayat Hari Ini ({recent.length})
            </p>
            <div className="flex gap-1">
              {(
                [
                  { v: "all" as const, l: "Semua", c: recent.length },
                  { v: "expense" as const, l: "Out", c: dashboard.outCount },
                  { v: "income" as const, l: "In", c: dashboard.inCount },
                ]
              ).map((f) => (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => setRecentFilter(f.v)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    recentFilter === f.v
                      ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
                  )}
                >
                  {f.l} ({f.c})
                </button>
              ))}
            </div>
          </div>
          {loadingRecent ? (
            <div className="mt-2 space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredRecent.length === 0 ? (
            <p className="mt-3 text-center text-xs italic text-neutral-500">
              {recent.length === 0
                ? "Belum ada entri hari ini."
                : "Tidak ada entri match filter."}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {filteredRecent.map(({ kind, row, ts }) => {
                const cat =
                  kind === "expense"
                    ? (row as Expense).categoryId
                      ? categoryById.get((row as Expense).categoryId)
                      : null
                    : null;
                const expRow = kind === "expense" ? (row as Expense) : null;
                const pending = pendingByEntityId.get(row.id);
                return (
                  <li
                    key={row.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border bg-white px-3 py-2",
                      pending ? "border-warning-300 bg-warning-50/40" : "border-neutral-200",
                      !pending && kind === "expense" && "border-l-4 border-l-danger-300",
                      !pending && kind === "income" && "border-l-4 border-l-success-500/40",
                    )}
                  >
                    <Badge
                      variant={kind === "expense" ? "danger" : "success"}
                      className="shrink-0"
                    >
                      {kind === "expense" ? "Out" : "In"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {row.description}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {formatIndonesianTime(new Date(ts))}
                        {cat ? ` · ${cat.name}` : ""}
                        {expRow?.receiptImageUrl ? " · 📎 ada bukti" : ""}
                      </p>
                      {pending ? (
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning-700">
                          ⏳ Pending {pending.operation === "delete" ? "hapus" : "edit"} — tunggu Owner approve
                        </p>
                      ) : null}
                    </div>
                    {expRow?.receiptImageUrl ? (
                      <a
                        href={expRow.receiptImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-mahakan-green-700"
                        aria-label="Lihat bukti transaksi"
                        title="Lihat bukti transaksi"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                    <span
                      className={cn(
                        "font-mono text-sm font-bold tabular-nums shrink-0",
                        kind === "expense"
                          ? "text-danger-500"
                          : "text-success-500",
                      )}
                    >
                      {kind === "expense" ? "−" : "+"}
                      {formatRupiah(row.amount)}
                    </span>
                    {/* Sesi AE-67 — Edit/Delete buttons (route via propose
                     * workflow). Disable kalau sudah ada pending change. */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setProposeModal({
                            open: true,
                            mode: "edit",
                            entityType: kind,
                            entity: row,
                          })
                        }
                        disabled={!!pending}
                        className="rounded-md p-1.5 text-neutral-500 transition hover:bg-warning-100 hover:text-warning-700 disabled:cursor-not-allowed disabled:opacity-30"
                        title={pending ? "Sudah ada pending koreksi" : "Ajukan edit"}
                        aria-label="Ajukan edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setProposeModal({
                            open: true,
                            mode: "delete",
                            entityType: kind,
                            entity: row,
                          })
                        }
                        disabled={!!pending}
                        className="rounded-md p-1.5 text-neutral-500 transition hover:bg-danger-100 hover:text-danger-500 disabled:cursor-not-allowed disabled:opacity-30"
                        title={pending ? "Sudah ada pending koreksi" : "Ajukan hapus"}
                        aria-label="Ajukan hapus"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
      {/* Sesi AE-67 — Propose entry change modal (Edit/Hapus dengan owner approval) */}
      <ProposeEntryChangeModal
        open={proposeModal.open}
        mode={proposeModal.mode}
        entityType={proposeModal.entityType}
        entity={proposeModal.entity}
        onClose={() => setProposeModal((p) => ({ ...p, open: false }))}
        onSubmitted={() => {
          setProposeModal((p) => ({ ...p, open: false }));
          setRefreshKey((k) => k + 1);
        }}
      />
    </Card>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone: "neutral" | "success" | "danger" | "warning";
  icon: ReactNode;
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-neutral-200 bg-white text-neutral-900",
    success: "border-success-500/30 bg-success-100/40 text-success-500",
    danger: "border-danger-300 bg-danger-100/30 text-danger-500",
    warning: "border-warning-500/30 bg-warning-100/40 text-warning-500",
  };
  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClasses[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-bold sm:text-base">
        {value}
      </div>
      {sublabel ? (
        <div className="mt-0.5 text-[10px] opacity-70">{sublabel}</div>
      ) : null}
    </div>
  );
}

function NumKey({
  label,
  onPress,
  disabled,
  variant,
  ariaLabel,
}: {
  label: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  variant?: "muted";
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        onPress();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
      style={{ touchAction: "manipulation" }}
      disabled={disabled}
      className={cn(
        "flex h-12 items-center justify-center rounded-lg border-2 text-lg font-bold transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
          : "border-neutral-200 bg-white text-neutral-900 hover:bg-mahakan-green-50",
      )}
    >
      {label}
    </button>
  );
}
