"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  EmptyCard,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { IncomeFormModal } from "./IncomeFormModal";
import {
  deleteIncome,
  isOk,
  listIncomes,
  type CashPaymentMethod,
  type Income,
} from "@/features/cash";
import { useSession } from "@/features/auth/SessionProvider";
import { formatRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

interface IncomesListProps {
  createdBy: string;
}

type MethodFilter = "all" | CashPaymentMethod;

export function IncomesList({ createdBy }: IncomesListProps) {
  const { session } = useSession();
  const role = session?.user.role;
  /* Sesi AE-123 — RBAC: pemasukan create/edit/delete pakai permission yang
   * sama (`income.create`). Tampilkan tombol Edit/Hapus untuk owner +
   * manager yang punya permission. */
  const canMutate = role === "owner" || role === "manager";

  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Income | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Income | null>(null);

  const today = todayJakarta();
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  /* Sesi AE-123 — filter metode pembayaran. Default "all" tampilkan semua. */
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await listIncomes({
        from,
        to,
        paymentMethod: methodFilter === "all" ? undefined : methodFilter,
        limit: 200,
      });
      if (cancelled) return;
      if (isOk(res)) setIncomes(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, from, to, methodFilter]);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const res = await deleteIncome(deleteTarget.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Pemasukan dihapus");
    setDeleteTarget(null);
    setRefreshKey((k) => k + 1);
  }

  const total = incomes.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Pemasukan Non-POS ({incomes.length}) ·{" "}
            <span className="font-mono">{formatRupiah(total)}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Pemasukan dari luar transaksi POS (sewa ruang, titip jual, dll).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> Tambah Pemasukan
        </Button>
      </header>

      <Card>
        <CardHeader>
          {/* Sesi AE-123 — filter metode pembayaran (parity dengan
           * ExpensesList yg punya filter kategori). */}
          <div className="grid gap-3 md:grid-cols-2">
            <DateRangePicker
              label="Periode"
              value={{ from, to }}
              onChange={(v) => {
                setFrom(v.from ?? monthStart);
                setTo(v.to ?? today);
              }}
            />
            <Select
              label="Metode Pembayaran"
              options={[
                { value: "all", label: "Semua metode" },
                { value: "cash", label: "Tunai" },
                { value: "transfer", label: "Transfer BCA" },
                { value: "other", label: "Bank Lain-lain" },
              ]}
              value={methodFilter}
              onValueChange={(v) => setMethodFilter(v as MethodFilter)}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat pemasukan">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : incomes.length === 0 ? (
            <EmptyCard
              icon={ArrowUpCircle}
              title="Tidak ada pemasukan di range ini"
              description="Sesuaikan tanggal/metode di atas — atau catat pemasukan kas baru."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-4 py-2 text-left font-medium">Deskripsi</th>
                    <th className="px-4 py-2 text-left font-medium">Metode</th>
                    <th className="px-4 py-2 text-right font-medium">Nominal</th>
                    {canMutate ? (
                      <th className="px-4 py-2 text-right font-medium">Aksi</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {incomes.map((i) => (
                    <tr key={i.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        {i.incomeDate}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {i.description}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700 capitalize">
                        {i.paymentMethod}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-success-500">
                        +{formatRupiah(i.amount)}
                      </td>
                      {canMutate ? (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditTarget(i)}
                              aria-label="Edit pemasukan"
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteTarget(i)}
                              aria-label="Hapus pemasukan"
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-neutral-200 bg-neutral-50">
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-3 text-right text-xs font-medium text-neutral-500"
                    >
                      TOTAL
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-neutral-900">
                      {formatRupiah(total)}
                    </td>
                    {canMutate ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <IncomeFormModal
        open={createOpen || editTarget !== null}
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

      {/* Sesi AE-123 — delete confirm modal mirror ExpensesList pattern. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus pemasukan?"
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
