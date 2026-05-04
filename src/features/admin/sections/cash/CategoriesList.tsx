"use client";

import { useEffect, useState } from "react";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  createExpenseCategory,
  deleteExpenseCategory,
  isOk,
  listExpenseCategories,
  updateExpenseCategory,
  type ExpenseCategory,
} from "@/features/cash";
import { useSession } from "@/features/auth/SessionProvider";

export function CategoriesList() {
  const { session } = useSession();
  const role = session?.user.role;
  const isOwner = role === "owner";
  const canCreate = role === "owner" || role === "manager";

  const [items, setItems] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [editTarget, setEditTarget] = useState<ExpenseCategory | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await listExpenseCategories();
      if (cancelled) return;
      if (isOk(res)) setItems(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function startEdit(cat: ExpenseCategory) {
    setEditTarget(cat);
    setEditName(cat.name);
    setError(null);
  }

  async function handleCreate() {
    if (submitting || !createName.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await createExpenseCategory(createName.trim());
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Kategori "${res.data.name}" dibuat`);
    setCreateOpen(false);
    setCreateName("");
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  async function handleEdit() {
    if (submitting || !editTarget || !editName.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await updateExpenseCategory(editTarget.id, editName.trim());
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Kategori "${res.data.name}" diperbarui`);
    setEditTarget(null);
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await deleteExpenseCategory(deleteTarget.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Kategori "${deleteTarget.name}" dihapus`);
    setDeleteTarget(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Kategori Pengeluaran ({items.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Kategori dipakai oleh form pengeluaran. Sistem (Refund) tidak bisa di-rename
            atau dihapus.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setCreateName("");
              setError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Tambah Kategori
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <p className="text-xs text-neutral-500">
            Owner saja yang bisa edit/hapus. Manager hanya bisa tambah baru.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat kategori">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyCard
              icon={FolderTree}
              title="Belum ada kategori"
              description="Buat kategori pengeluaran biar laporan kas lebih rapi."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-left font-medium">Tipe</th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((c) => (
                    <tr key={c.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {c.name}
                      </td>
                      <td className="px-4 py-3">
                        {c.isSystem ? (
                          <Badge variant="warning">System</Badge>
                        ) : (
                          <Badge variant="neutral">Custom</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isOwner && !c.isSystem && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEdit(c)}
                                aria-label="Edit"
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteTarget(c)}
                                aria-label="Hapus"
                                className="text-danger-500 hover:bg-danger-100"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Kategori Pengeluaran"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="Nama"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={60}
            required
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`Edit Kategori${editTarget ? ` "${editTarget.name}"` : ""}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={handleEdit} loading={submitting}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="Nama"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            maxLength={60}
            required
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus kategori?"
        description={deleteTarget ? `"${deleteTarget.name}"` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Pengeluaran lama yang pakai kategori ini tetap utuh. Kategori dengan
          pengeluaran aktif tidak bisa dihapus — pindahkan dulu.
        </p>
      </Modal>
    </div>
  );
}
