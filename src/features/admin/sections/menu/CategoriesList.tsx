"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { isOk, menuService } from "@/mocks/services";
import type { Category, MenuItem } from "@/mocks/types";

export function CategoriesList() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingName, setEditingName] = useState("");
  const [creatingName, setCreatingName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [catRes, itemRes] = await Promise.all([
        menuService.listCategories(),
        menuService.listMenuItems({ activeOnly: false }),
      ]);
      if (cancelled) return;
      if (isOk(catRes)) setCategories(catRes.data.items);
      if (isOk(itemRes)) setItems(itemRes.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function countItems(catId: string): number {
    return items.filter((i) => i.categoryId === catId).length;
  }

  async function handleReorder(cat: Category, dir: "up" | "down") {
    const res = await menuService.reorderCategory(cat.id, dir);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  async function handleCreate() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await menuService.createCategory(creatingName);
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Kategori dibuat");
    setCreateOpen(false);
    setCreatingName("");
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  async function handleSaveEdit() {
    if (!editingCat || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await menuService.updateCategory(editingCat.id, {
      name: editingName,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Kategori disimpan");
    setEditingCat(null);
    setEditingName("");
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!pendingDelete || submitting) return;
    setSubmitting(true);
    const res = await menuService.deleteCategory(pendingDelete.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Kategori dihapus");
    setPendingDelete(null);
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Kategori ({categories.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Urutan menentukan tampilan tab kategori di POS.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> Tambah Kategori
        </Button>
      </header>

      <Card>
        <CardHeader />
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat kategori">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {categories.map((cat, idx) => (
                <div
                  key={cat.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleReorder(cat, "up")}
                      aria-label="Pindah ke atas"
                      className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={idx === categories.length - 1}
                      onClick={() => handleReorder(cat, "down")}
                      aria-label="Pindah ke bawah"
                      className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  <span className="w-8 font-mono text-xs text-neutral-500">
                    #{cat.displayOrder}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-900">{cat.name}</p>
                    <p className="text-xs text-neutral-500">
                      {countItems(cat.id)} item
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingCat(cat);
                        setEditingName(cat.name);
                        setError(null);
                      }}
                      aria-label={`Edit ${cat.name}`}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingDelete(cat)}
                      aria-label={`Hapus ${cat.name}`}
                      className="text-danger-500 hover:bg-danger-100"
                      disabled={countItems(cat.id) > 0}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreatingName("");
          setError(null);
        }}
        title="Tambah Kategori"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
                setCreatingName("");
                setError(null);
              }}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              Simpan
            </Button>
          </>
        }
      >
        <Input
          label="Nama Kategori"
          value={creatingName}
          onChange={(e) => setCreatingName(e.target.value)}
          placeholder="Misal: Pastry"
          autoFocus
          maxLength={50}
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </Modal>

      {/* Edit modal */}
      <Modal
        open={editingCat !== null}
        onClose={() => {
          setEditingCat(null);
          setEditingName("");
          setError(null);
        }}
        title={editingCat ? `Edit ${editingCat.name}` : "Edit Kategori"}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setEditingCat(null);
                setEditingName("");
                setError(null);
              }}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleSaveEdit} loading={submitting}>
              Simpan
            </Button>
          </>
        }
      >
        <Input
          label="Nama Kategori"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          autoFocus
          maxLength={50}
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Hapus kategori?"
        description={`"${pendingDelete?.name ?? ""}" akan dihapus. Pastikan tidak ada item aktif.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={submitting}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Aksi ini soft-delete — bisa di-restore via DB nanti kalau perlu.
        </p>
      </Modal>
    </div>
  );
}
