"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DatePicker,
  DateRangePicker,
  EmptyCard,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { ExpenseFormModal } from "./ExpenseFormModal";
import {
  bulkDeleteExpenses,
  deleteExpense,
  duplicateExpense,
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /* Sesi AE-123 — bulk select state. Set<id> untuk efisien lookup. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  /* Sesi AE-123 — duplicate state. duplicateSource null → modal closed. */
  const [duplicateSource, setDuplicateSource] = useState<Expense | null>(null);
  const [duplicateDates, setDuplicateDates] = useState<string[]>([]);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);

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

  /* Sesi AE-123 — bulk delete handler. Loop deleteExpense via server
   * action `bulkDeleteExpenses` supaya lock check + audit per item tetap
   * berjalan. Report partial success/failures via toast. */
  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkSubmitting(true);
    const res = await bulkDeleteExpenses(Array.from(selectedIds));
    setBulkSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const { deleted, failed } = res.data;
    if (failed.length === 0) {
      toast.success(`${deleted} pengeluaran dihapus`);
    } else {
      toast.error(
        `${deleted} berhasil, ${failed.length} gagal: ${failed[0].message}`,
      );
    }
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
    setRefreshKey((k) => k + 1);
  }

  /* Sesi AE-123 — duplicate handler. Owner pilih 1 expense → tentukan
   * dates untuk N copy. Server reject kalau date di luar range -30/+1. */
  async function handleDuplicate() {
    if (!duplicateSource) return;
    if (duplicateDates.length === 0) {
      toast.error("Pilih minimal 1 tanggal");
      return;
    }
    setDuplicateSubmitting(true);
    const res = await duplicateExpense({
      sourceId: duplicateSource.id,
      dates: duplicateDates,
    });
    setDuplicateSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const { created, failed } = res.data;
    if (failed.length === 0) {
      toast.success(`${created} duplikat dibuat`);
    } else {
      toast.error(
        `${created} berhasil, ${failed.length} gagal: ${failed[0].message}`,
      );
    }
    setDuplicateSource(null);
    setDuplicateDates([]);
    setRefreshKey((k) => k + 1);
  }

  /* Sesi AE-123 — selectable items (exclude refund auto-generated, tidak
   * boleh di-hapus per business rule). */
  const selectableIds = useMemo(
    () => expenses.filter((e) => !e.refundedTransactionId).map((e) => e.id),
    [expenses],
  );
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* Clear selection saat filter ganti (kalau tidak, ada selected yang
   * hilang dari view tapi masih dianggap selected). */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedIds(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [from, to, categoryFilter]);

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
              label="Kategori"
              options={[
                { value: "all", label: "Semua kategori" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as string | "all")}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {/* Sesi AE-123 — bulk actions bar. Tampil saat ada row dipilih.
           * Sticky di atas table supaya tetap visible saat scroll. */}
          {someSelected && role === "owner" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-mahakan-green-50 px-4 py-2 text-sm">
              <div className="flex items-center gap-2 font-medium text-mahakan-green-900">
                <span>{selectedIds.size} dipilih</span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs font-normal text-neutral-600 hover:underline"
                >
                  Batal pilih
                </button>
              </div>
              <div className="flex gap-2">
                {selectedIds.size === 1 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const id = Array.from(selectedIds)[0];
                      const exp = expenses.find((e) => e.id === id);
                      if (exp) {
                        setDuplicateSource(exp);
                        setDuplicateDates([today]);
                      }
                    }}
                  >
                    <Copy className="size-4" aria-hidden /> Duplikat ke
                    Tanggal Lain
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="size-4" aria-hidden /> Hapus{" "}
                  {selectedIds.size} Item
                </Button>
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat pengeluaran">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <EmptyCard
              icon={ArrowDownCircle}
              title="Tidak ada pengeluaran di range ini"
              description="Sesuaikan tanggal atau filter kategori — atau catat pengeluaran baru."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    {/* Sesi AE-123 — checkbox header. Owner-only (delete
                     * permission). Manager tetap bisa edit tanpa checkbox. */}
                    {role === "owner" ? (
                      <th className="w-10 px-3 py-2 text-left">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          disabled={selectableIds.length === 0}
                          className="size-4 cursor-pointer accent-mahakan-green-700"
                        />
                      </th>
                    ) : null}
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
                    const isChecked = selectedIds.has(e.id);
                    const canSelect = !e.refundedTransactionId;
                    return (
                      <tr
                        key={e.id}
                        className={
                          isChecked
                            ? "bg-mahakan-green-50/40"
                            : "hover:bg-neutral-50"
                        }
                      >
                        {role === "owner" ? (
                          <td className="w-10 px-3 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${e.description}`}
                              checked={isChecked}
                              onChange={() => toggleSelect(e.id)}
                              disabled={!canSelect}
                              className="size-4 cursor-pointer accent-mahakan-green-700 disabled:cursor-not-allowed disabled:opacity-30"
                            />
                          </td>
                        ) : null}
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
                          <div className="flex items-center gap-2">
                            {e.receiptImageUrl ? (
                              e.receiptImageUrl.includes("drive.google.com") ? (
                                <a
                                  href={e.receiptImageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex size-9 shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-mahakan-green-700 transition hover:border-mahakan-green-500"
                                  aria-label="Buka foto struk di Google Drive"
                                  title="Foto struk · Google Drive"
                                >
                                  📄
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPreviewUrl(e.receiptImageUrl ?? null)}
                                  className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-neutral-50 transition hover:border-mahakan-green-500"
                                  aria-label="Lihat foto struk"
                                  title="Lihat foto struk"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={e.receiptImageUrl}
                                    alt=""
                                    className="size-full object-cover"
                                  />
                                </button>
                              )
                            ) : null}
                            <span>
                              {e.description}
                              {e.refundedTransactionId ? (
                                <span className="ml-2 text-xs text-neutral-500">
                                  (auto-generated)
                                </span>
                              ) : null}
                            </span>
                          </div>
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
                            {/* Sesi AE-123 — duplicate single-row button.
                             * Owner-only, skip auto-generated refund. */}
                            {role === "owner" && !e.refundedTransactionId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDuplicateSource(e);
                                  setDuplicateDates([today]);
                                }}
                                aria-label="Duplikat pengeluaran"
                                title="Duplikat ke tanggal lain (mis. belanja rutin)"
                              >
                                <Copy className="size-4" aria-hidden />
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
                    {role === "owner" ? <td /> : null}
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
        open={previewUrl !== null}
        onClose={() => setPreviewUrl(null)}
        title="Foto Struk"
        size="lg"
      >
        {previewUrl ? (
          <div className="flex flex-col items-center gap-3">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Foto struk"
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            </a>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-mahakan-green-700 underline"
            >
              Buka di tab baru
            </a>
          </div>
        ) : null}
      </Modal>

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

      {/* Sesi AE-123 — bulk delete confirm modal. Loop deleteExpense via
       * bulkDeleteExpenses server action. */}
      <Modal
        open={bulkDeleteOpen}
        onClose={() => (bulkSubmitting ? undefined : setBulkDeleteOpen(false))}
        title={`Hapus ${selectedIds.size} pengeluaran?`}
        description="Aksi soft-delete untuk semua item terpilih. Tidak bisa di-undo otomatis (audit log mencatat siapa yang hapus)."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkSubmitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              loading={bulkSubmitting}
            >
              Hapus {selectedIds.size} Item
            </Button>
          </>
        }
      >
        <ul className="max-h-48 list-disc space-y-1 overflow-y-auto rounded-md bg-neutral-50 px-5 py-3 text-xs text-neutral-700">
          {Array.from(selectedIds)
            .slice(0, 10)
            .map((id) => {
              const exp = expenses.find((e) => e.id === id);
              if (!exp) return null;
              return (
                <li key={id}>
                  {exp.expenseDate} · {exp.description} ·{" "}
                  <span className="font-mono">{formatRupiah(exp.amount)}</span>
                </li>
              );
            })}
          {selectedIds.size > 10 ? (
            <li className="font-medium italic">
              … {selectedIds.size - 10} item lain
            </li>
          ) : null}
        </ul>
      </Modal>

      {/* Sesi AE-123 — duplicate modal. Owner pilih 1+ tanggal untuk
       * copy expense ini ke tanggal lain (mis. belanja rutin harian).
       * Receipt foto tidak ikut (per-transaksi). */}
      <Modal
        open={duplicateSource !== null}
        onClose={() =>
          duplicateSubmitting
            ? undefined
            : (setDuplicateSource(null), setDuplicateDates([]))
        }
        title="Duplikat Pengeluaran"
        description={
          duplicateSource
            ? `"${duplicateSource.description}" · ${formatRupiah(duplicateSource.amount)} · ${duplicateSource.expenseDate}`
            : ""
        }
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDuplicateSource(null);
                setDuplicateDates([]);
              }}
              disabled={duplicateSubmitting}
            >
              Batal
            </Button>
            <Button
              onClick={handleDuplicate}
              loading={duplicateSubmitting}
              disabled={duplicateDates.length === 0}
            >
              <Copy className="size-4" aria-hidden /> Buat{" "}
              {duplicateDates.length} Duplikat
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md bg-info-50 px-3 py-2 text-xs text-info-700">
            Akan dibuat <strong>{duplicateDates.length}</strong> pengeluaran
            baru dengan deskripsi, kategori, nominal, dan metode yang sama.
            Foto struk tidak ikut (per-transaksi). Audit log mencatat semua.
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Tanggal target ({duplicateDates.length})
            </p>
            {duplicateDates.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <DatePicker
                  ariaLabel={`Tanggal duplikat ${idx + 1}`}
                  value={d}
                  onChange={(v) =>
                    setDuplicateDates((prev) =>
                      prev.map((p, i) => (i === idx ? (v ?? today) : p)),
                    )
                  }
                  clearable={false}
                />
                {duplicateDates.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDuplicateDates((prev) =>
                        prev.filter((_, i) => i !== idx),
                      )
                    }
                    aria-label={`Hapus tanggal ${d}`}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDuplicateDates((prev) => [...prev, today])
              }
              disabled={duplicateDates.length >= 60}
            >
              <Plus className="size-4" aria-hidden /> Tambah tanggal
            </Button>
            {duplicateDates.length >= 60 ? (
              <p className="text-[11px] text-warning-700">
                Maks 60 tanggal per batch
              </p>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
