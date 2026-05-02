"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, Truck } from "lucide-react";
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
import {
  deleteSupplier,
  isOk,
  listSuppliers,
  type Supplier,
} from "@/features/suppliers";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { SupplierFormModal } from "./SupplierFormModal";

export function SuppliersList() {
  const { session } = useSession();
  const role = session?.user.role;
  const canCreate = role
    ? hasPermission(role, "supplier.create")
    : false;
  const canDelete = role
    ? hasPermission(role, "supplier.delete")
    : false;

  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listSuppliers({
        activeOnly: !showInactive,
        search: search.trim() || undefined,
      });
      if (cancelled) return;
      if (isOk(res)) setItems(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, search, showInactive]);

  const filtered = useMemo(() => items, [items]);
  const activeCount = useMemo(
    () => items.filter((s) => s.isActive).length,
    [items],
  );
  const inactiveCount = items.length - activeCount;

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    const res = await deleteSupplier(deleteTarget.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Supplier ${deleteTarget.name} dihapus`);
    setDeleteTarget(null);
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Truck className="size-6" aria-hidden /> Supplier
            {!loading ? (
              <span className="ml-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
                {activeCount}
                {inactiveCount > 0 ? ` / ${items.length}` : ""}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-neutral-700">
            Master vendor dengan default term pembayaran (TOP). Dipakai
            saat catat pembelanjaan.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Tambah Supplier
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <Input
                label="Cari nama / kategori"
                placeholder="mis. Vina, Cup, Beans"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leadingIcon={<Search className="size-4" aria-hidden />}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              Tampilkan non-aktif
            </label>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              {search ? (
                <>
                  <p className="text-sm text-neutral-500">
                    Tidak ada supplier yang cocok dengan &ldquo;{search}&rdquo;.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setSearch("")}
                  >
                    Reset pencarian
                  </Button>
                </>
              ) : (
                <p className="text-sm text-neutral-500">
                  Belum ada supplier. Klik &ldquo;Tambah Supplier&rdquo; untuk mulai.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Kategori
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      Kontak
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Default TOP
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-neutral-900">
                            {s.name}
                          </span>
                          {!s.isActive ? (
                            <Badge variant="neutral">Non-aktif</Badge>
                          ) : null}
                        </div>
                        {s.notes ? (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {s.notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {s.category ?? (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {s.contact ?? (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {s.defaultPaymentTermDays === 0
                          ? "Cash"
                          : `${s.defaultPaymentTermDays} hari`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Edit supplier"
                            title="Edit"
                            onClick={() => setEditTarget(s)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          {canDelete && s.isActive ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Hapus supplier"
                              title="Hapus"
                              onClick={() => setDeleteTarget(s)}
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          ) : null}
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

      <SupplierFormModal
        open={createOpen || editTarget !== null}
        edit={editTarget}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditTarget(null);
          refresh();
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus supplier?"
        description={
          deleteTarget
            ? `${deleteTarget.name}${deleteTarget.category ? ` · ${deleteTarget.category}` : ""}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Soft-delete: supplier disembunyikan dari list aktif. Histori
          pembelian yang merefer supplier ini tetap terjaga.
        </p>
      </Modal>
    </div>
  );
}
