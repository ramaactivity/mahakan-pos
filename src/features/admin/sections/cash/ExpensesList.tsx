"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { ExpenseFormModal } from "./ExpenseFormModal";
import {
  deleteExpense,
  isOk,
  listExpenses,
  listExpenseCategories,
  type Expense,
  type ExpenseCategory,
} from "@/features/cash";
import { useSession } from "@/features/auth/SessionProvider";
import { formatRupiah } from "@/lib/format";

interface ExpensesListProps {
  createdBy: string;
}

export function ExpensesList({ createdBy }: ExpensesListProps) {
  const { session } = useSession();
  const role = session?.user.role;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  // Default: this month
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [expRes, catRes] = await Promise.all([
        listExpenses({
          from,
          to,
          categoryId: categoryFilter === "all" ? undefined : categoryFilter,
          limit: 200,
        }),
        listExpenseCategories(),
      ]);
      if (cancelled) return;
      if (isOk(expRes)) setExpenses(expRes.data.items);
      if (isOk(catRes)) setCategories(catRes.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, from, to, categoryFilter]);

  const categoryById = useMemo(() => {
    const m: Record<string, ExpenseCategory> = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  // Snapshot "now" to a state so the manager 24h-edit cutoff is computed
  // against a stable timestamp; bumped each load to keep the cutoff current.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
  }, [refreshKey]);
  function canEditRow(e: Expense): boolean {
    if (e.refundedTransactionId) return false;
    if (role === "owner") return true;
    if (role === "manager") {
      return nowMs - e.createdAt.getTime() <= 24 * 60 * 60 * 1000;
    }
    return false;
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const res = await deleteExpense(deleteTarget.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Pengeluaran dihapus");
    setDeleteTarget(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Pengeluaran ({expenses.length}) ·{" "}
            <span className="font-mono">{formatRupiah(total)}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Kategori &ldquo;Refund&rdquo; auto-generate saat refund transaksi.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> Tambah Pengeluaran
        </Button>
      </header>

      <Card>
        <CardHeader>
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              label="Dari Tanggal"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="Sampai Tanggal"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-neutral-900">
                Kategori
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
              >
                <option value="all">Semua kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat pengeluaran">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada pengeluaran di range ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-4 py-2 text-left font-medium">Kategori</th>
                    <th className="px-4 py-2 text-left font-medium">Deskripsi</th>
                    <th className="px-4 py-2 text-left font-medium">Metode</th>
                    <th className="px-4 py-2 text-right font-medium">Nominal</th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {expenses.map((e) => {
                    const cat = categoryById[e.categoryId];
                    const editable = canEditRow(e);
                    return (
                      <tr key={e.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          {e.expenseDate}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={cat?.isSystem ? "warning" : "neutral"}
                          >
                            {cat?.name ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {e.description}
                          {e.refundedTransactionId ? (
                            <span className="ml-2 text-xs text-neutral-500">
                              (auto-generated)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700 capitalize">
                          {e.paymentMethod}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatRupiah(e.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {editable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditTarget(e)}
                                aria-label="Edit pengeluaran"
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                            )}
                            {role === "owner" && !e.refundedTransactionId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteTarget(e)}
                                aria-label="Hapus pengeluaran"
                                className="text-danger-500 hover:bg-danger-100"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-neutral-200 bg-neutral-50">
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-3 text-right text-xs font-medium text-neutral-500"
                    >
                      TOTAL
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-neutral-900">
                      {formatRupiah(total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ExpenseFormModal
        open={createOpen || editTarget !== null}
        categories={categories}
        createdBy={createdBy}
        edit={editTarget}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditTarget(null);
          setRefreshKey((k) => k + 1);
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus pengeluaran?"
        description={
          deleteTarget
            ? `"${deleteTarget.description}" — ${formatRupiah(deleteTarget.amount)}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Aksi ini di-soft-delete; ringkasan keuangan langsung di-update. Audit
          log mencatat siapa yang menghapus.
        </p>
      </Modal>
    </div>
  );
}
