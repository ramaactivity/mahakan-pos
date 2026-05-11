"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  Flame,
  Hammer,
  HandHelping,
  Heart,
  ListTree,
  PartyPopper,
  RefreshCw,
  Scissors,
  Snowflake,
  TrendingUp,
  Wallet,
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
  NumericInput,
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
  type Expense,
  type ExpenseCategory,
  type Income,
} from "@/features/cash";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayWibIso } from "@/features/cash/helpers";
import { formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type Mode = "expense" | "income";

/** Sesi AE-38 — quick-pick chips untuk transaksi sehari-hari di toko.
 *  Owner: bukan corporate expense — fokus daily ops Mahakan Coffee.
 *  Chip keyword juga di-match ke category name (best-effort auto-select). */
interface QuickPick {
  label: string;
  description: string;
  icon: typeof Flame;
  /** Substring untuk match category name. */
  categoryKeywords?: string[];
}

const EXPENSE_QUICK_PICKS: QuickPick[] = [
  {
    label: "Gas LPG",
    description: "Beli gas LPG dapur",
    icon: Flame,
    categoryKeywords: ["gas", "lpg"],
  },
  {
    label: "Ice Cube",
    description: "Beli es batu kristal",
    icon: Snowflake,
    categoryKeywords: ["es batu", "ice"],
  },
  {
    label: "Galon Karyawan",
    description: "Refill galon air karyawan",
    icon: Wallet,
    categoryKeywords: ["galon", "air"],
  },
  {
    label: "Galon Cleo",
    description: "Beli galon Cleo untuk produksi kopi",
    icon: Wallet,
    categoryKeywords: ["galon cleo", "cleo", "air"],
  },
  {
    label: "Tukang Rumput",
    description: "Bayar tukang rumput",
    icon: Scissors,
    categoryKeywords: ["rumput", "kebersihan", "maintenance"],
  },
  {
    label: "Perbaikan",
    description: "Perbaikan peralatan / fasilitas",
    icon: Hammer,
    categoryKeywords: ["perbaikan", "maintenance", "service"],
  },
  {
    label: "Sumbangan",
    description: "Sumbangan / donasi",
    icon: Heart,
    categoryKeywords: ["sumbangan", "donasi"],
  },
  {
    label: "Lainnya",
    description: "",
    icon: ListTree,
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

/**
 * Sesi AE-38 redesign — Petty Cash UI mengikuti pattern AE-35/36/37
 * (Pesanan / Bill Aktif / Riwayat).
 *
 * Dashboard cards (4):
 *   - Pengeluaran hari ini | Pemasukan hari ini | Net Petty Cash | Entry
 *
 * Quick-pick chips per mode:
 *   - Pengeluaran: Gas LPG, Ice Cube, Galon Karyawan, Galon Cleo,
 *     Tukang Rumput, Perbaikan, Sumbangan, Lainnya
 *   - Pemasukan: DP Event, Tip Customer, Lainnya
 *   Tap chip → auto-fill description + (kalau ada) auto-select kategori
 *
 * Recent list:
 *   - Show 10 entri hari ini, newest first
 *   - Per row: time prominent, badge In/Out, description, category, amount
 *   - Search by description / category
 */
export function PettyCashCard() {
  const [mode, setMode] = useState<Mode>("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
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

  // Load categories once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listExpenseCategories();
      if (cancelled) return;
      if (isOk(res)) {
        setCategories(res.data.items);
        if (res.data.items.length > 0 && categoryId === "") {
          setCategoryId(res.data.items[0]!.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // Load today's recent entries.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasLoadedOnce.current) setLoadingRecent(true);
      const today = todayWibIso();
      const [expRes, incRes] = await Promise.all([
        listExpenses({ from: today, to: today, limit: 50 }),
        listIncomes({ from: today, to: today, limit: 50 }),
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
      setLoadingRecent(false);
      hasLoadedOnce.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  let parsedAmount = 0;
  try {
    parsedAmount = amount.length > 0 ? parseRupiah(amount) : 0;
  } catch {
    parsedAmount = 0;
  }

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

  // Find category by keyword match (case-insensitive). Returns first hit.
  const categoryById = useMemo(() => {
    const m = new Map<string, ExpenseCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  function applyQuickPick(pick: QuickPick) {
    setDescription(pick.description);
    if (mode === "expense" && pick.categoryKeywords) {
      const lcCats = categories.map((c) => ({
        id: c.id,
        lc: c.name.toLowerCase(),
      }));
      for (const kw of pick.categoryKeywords) {
        const hit = lcCats.find((c) => c.lc.includes(kw.toLowerCase()));
        if (hit) {
          setCategoryId(hit.id);
          break;
        }
      }
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (description.trim().length === 0) {
      setError("Deskripsi wajib");
      return;
    }
    if (parsedAmount <= 0) {
      setError("Nominal harus lebih dari nol");
      return;
    }
    if (mode === "expense" && categoryId.length === 0) {
      setError("Pilih kategori untuk pengeluaran");
      return;
    }

    setSubmitting(true);
    const today = todayWibIso();

    if (mode === "expense") {
      const res = await createExpense({
        expenseDate: today,
        categoryId,
        description: description.trim(),
        amount: parsedAmount,
        paymentMethod: "cash",
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success(`Pengeluaran ${formatRupiah(parsedAmount)} dicatat`);
    } else {
      const res = await createIncome({
        incomeDate: today,
        description: description.trim(),
        amount: parsedAmount,
        paymentMethod: "cash",
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success(`Pemasukan ${formatRupiah(parsedAmount)} dicatat`);
    }

    setDescription("");
    setAmount("");
    setRefreshKey((k) => k + 1);
  }

  const quickPicks = mode === "expense" ? EXPENSE_QUICK_PICKS : INCOME_QUICK_PICKS;

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
              galon, tip, DP event, dll). Tap kategori cepat di bawah untuk
              auto-fill, atau ketik manual. Otomatis terangkum saat tutup shift.
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
      <CardContent className="space-y-4 px-6 pb-6">
        {/* Mode toggle */}
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
                setDescription("");
              }}
              disabled={submitting}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border-2 py-3 text-sm font-semibold transition-all",
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

        {/* Quick-pick chips */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Kategori Cepat
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {quickPicks.map((q) => {
              const Icon = q.icon;
              const active = description === q.description && q.description !== "";
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => applyQuickPick(q)}
                  disabled={submitting}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                    active
                      ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-mahakan-green-700 hover:bg-mahakan-green-50",
                    submitting && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
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
          />
          <NumericInput
            label="Nominal"
            value={amount}
            onChange={setAmount}
            prefix="Rp"
            hint={
              parsedAmount > 0
                ? `Preview: ${formatRupiah(parsedAmount)}`
                : undefined
            }
            disabled={submitting}
            required
          />
          {mode === "expense" ? (
            categories.length === 0 ? (
              <div className="rounded-md border border-warning-500/40 bg-warning-100/40 px-3 py-2 text-xs text-warning-500">
                ⚠️ Belum ada kategori pengeluaran. Owner / Manager perlu
                set di Back Office → Cash → Kategori dulu, supaya petty
                cash bisa dicatat. Saran kategori: <em>Petty Cash Toko</em>{" "}
                atau buat per-tipe (Gas, Es Batu, Galon, Maintenance,
                Sumbangan).
              </div>
            ) : (
              <Select
                label="Kategori"
                value={categoryId || undefined}
                onValueChange={(v) => setCategoryId(v)}
                disabled={submitting}
                placeholder="Pilih kategori"
                options={categories.map<SelectOption>((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            )
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100/40 px-3 py-2 text-sm font-medium text-danger-500"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            loading={submitting}
            disabled={
              submitting || (mode === "expense" && categories.length === 0)
            }
            fullWidth
            className={cn(
              "h-12 text-base",
              mode === "expense"
                ? "!bg-danger-500 hover:!bg-danger-700"
                : "!bg-success-500 hover:!bg-success-500",
            )}
          >
            {submitting
              ? "Memproses…"
              : `Catat ${mode === "expense" ? "Pengeluaran" : "Pemasukan"}${parsedAmount > 0 ? ` ${formatRupiah(parsedAmount)}` : ""}`}
          </Button>
        </form>

        {/* Today's recent list */}
        <div className="border-t border-neutral-200 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-neutral-900">
              Riwayat Hari Ini ({recent.length})
            </p>
            <div className="flex gap-1">
              {([
                { v: "all" as const, l: "Semua", c: recent.length },
                { v: "expense" as const, l: "Out", c: dashboard.outCount },
                { v: "income" as const, l: "In", c: dashboard.inCount },
              ]).map((f) => (
                <button
                  key={f.v}
                  type="button"
                  onClick={() => setRecentFilter(f.v)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
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
                return (
                  <li
                    key={row.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2",
                      kind === "expense" && "border-l-4 border-l-danger-300",
                      kind === "income" && "border-l-4 border-l-success-500/40",
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
                      </p>
                    </div>
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
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
  icon: React.ReactNode;
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
