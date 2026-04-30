"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  toast,
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
import { cn } from "@/lib/utils";

type Mode = "expense" | "income";

/**
 * In-POS petty cash recorder (Galih ask #12). Lets kasir log small
 * expenses (e.g. beli es batu, parkir kurir) or incomes (e.g. tip
 * customer dimasukin laci) tanpa harus pindah ke admin Cash.
 *
 * Reuses the existing cash.* server actions; outlet RBAC was extended
 * in C-4 to allow staff to create both expense + income (they can't
 * edit/delete past entries — only Owner/Manager can).
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
    Array<{ kind: Mode; row: Expense | Income }>
  >([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load categories once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listExpenseCategories();
      if (cancelled) return;
      if (isOk(res)) {
        setCategories(res.data.items);
        if (res.data.items.length > 0 && categoryId === "") {
          setCategoryId(res.data.items[0].id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // Load today's recent entries (combined view).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingRecent(true);
      const today = todayWibIso();
      const [expRes, incRes] = await Promise.all([
        listExpenses({ from: today, to: today, limit: 20 }),
        listIncomes({ from: today, to: today, limit: 20 }),
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
      setRecent(merged.slice(0, 8).map(({ kind, row }) => ({ kind, row })));
      setLoadingRecent(false);
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
      toast.success(
        `Pengeluaran ${formatRupiah(parsedAmount)} dicatat`,
      );
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-5 text-mahakan-green-700" aria-hidden />
          Petty Cash
        </CardTitle>
        <CardDescription>
          Catat pengeluaran kecil (es batu, parkir kurir) atau pemasukan
          ekstra (tip masuk laci) selama shift. Otomatis terangkum saat
          tutup shift.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
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
              onClick={() => setMode(opt.value)}
              disabled={submitting}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                mode === opt.value
                  ? opt.value === "expense"
                    ? "border-danger-500/40 bg-danger-100/40 text-danger-500"
                    : "border-success-500/40 bg-success-100/40 text-success-500"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
              )}
            >
              <opt.Icon className="size-4" aria-hidden />
              {opt.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            label="Deskripsi"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            placeholder={
              mode === "expense"
                ? "Misal: beli es batu, parkir GoFood"
                : "Misal: tip customer, kembalian masuk laci"
            }
            disabled={submitting}
            required
          />
          <Input
            label="Nominal"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value.replace(/[^\d]/g, ""))
            }
            hint={parsedAmount > 0 ? `Preview: ${formatRupiah(parsedAmount)}` : undefined}
            placeholder="0"
            disabled={submitting}
            required
          />
          {mode === "expense" ? (
            categories.length === 0 ? (
              <p className="text-xs text-warning-500">
                Belum ada kategori pengeluaran. Owner/Manager perlu set di
                admin Cash dulu.
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-neutral-900">
                  Kategori
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                  disabled={submitting}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || (mode === "expense" && categories.length === 0)}
            fullWidth
          >
            Catat {mode === "expense" ? "Pengeluaran" : "Pemasukan"}
          </Button>
        </form>

        <div className="border-t border-neutral-200 pt-3">
          <p className="mb-2 text-sm font-semibold text-neutral-900">
            Hari Ini
          </p>
          {loadingRecent ? (
            <div className="flex h-16 items-center justify-center">
              <Spinner className="size-5 text-mahakan-green-700" />
            </div>
          ) : recent.length === 0 ? (
            <p className="text-xs italic text-neutral-500">
              Belum ada entri hari ini.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map(({ kind, row }) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={kind === "expense" ? "danger" : "success"}
                      className="shrink-0"
                    >
                      {kind === "expense" ? "Out" : "In"}
                    </Badge>
                    <span className="truncate font-medium text-neutral-900">
                      {row.description}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "font-mono font-semibold shrink-0",
                      kind === "expense"
                        ? "text-danger-500"
                        : "text-success-500",
                    )}
                  >
                    {kind === "expense" ? "- " : "+ "}
                    {formatRupiah(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
