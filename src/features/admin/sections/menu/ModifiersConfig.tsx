"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyCard,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteModifier,
  isOk,
  listAllCategories,
  listModifiers,
  type Category,
  type Modifier,
} from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { ModifierFormModal } from "./ModifierFormModal";

type FormMode = { kind: "create" } | { kind: "edit"; modifier: Modifier };

export function ModifiersConfig() {
  const { session } = useSession();
  const role = session?.user.role;
  const canCreate = role
    ? hasPermission(role, "menu.modifier.create")
    : false;
  const canUpdate = role
    ? hasPermission(role, "menu.modifier.update")
    : false;
  const canDelete = role
    ? hasPermission(role, "menu.modifier.delete")
    : false;

  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Modifier | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [modRes, catRes] = await Promise.all([
        listModifiers(),
        listAllCategories(),
      ]);
      if (cancelled) return;
      if (isOk(modRes)) setModifiers(modRes.data.items);
      if (isOk(catRes)) setCategories(catRes.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const res = await deleteModifier(deleteTarget.slug);
    setDeleting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Modifier "${deleteTarget.label}" dihapus`);
    setDeleteTarget(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Modifier ({modifiers.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Toggle (yes/no, mis. Extra Shot) atau pilihan terbatas (mis.
            Sugar level). Atur harga + kategori yang berlaku.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setFormMode({ kind: "create" })}>
            <Plus className="size-4" /> Tambah Modifier
          </Button>
        ) : null}
      </header>

      {loading ? (
        <div
          className="grid gap-3 md:grid-cols-2"
          role="status"
          aria-label="Memuat modifier"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : modifiers.length === 0 ? (
        <EmptyCard
          icon={Plus}
          title="Belum ada modifier"
          description="Buat modifier (Sugar Level, Extra Shot, dll) supaya kasir bisa apply di POS."
          action={
            canCreate ? (
              <Button onClick={() => setFormMode({ kind: "create" })}>
                <Plus className="size-4" /> Tambah Modifier
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {modifiers.map((mod) => (
            <Card key={mod.slug}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {mod.label}
                      {!mod.isActive ? (
                        <Badge variant="neutral">Non-aktif</Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {mod.slug}
                    </CardDescription>
                  </div>
                  <Badge variant={mod.type === "toggle" ? "info" : "neutral"}>
                    {mod.type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {mod.type === "toggle" ? (
                  <div>
                    <p className="text-xs text-neutral-500">Harga</p>
                    <p className="font-mono text-lg font-bold text-neutral-900">
                      +{formatRupiah(mod.price)}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">
                      Pilihan{" "}
                      {mod.price > 0 ? (
                        <span className="text-neutral-700">
                          (+{formatRupiah(mod.price)} / pilihan)
                        </span>
                      ) : null}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {mod.optionsJson?.map((opt) => (
                        <Badge key={opt.value} variant="neutral">
                          {opt.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs text-neutral-500">
                  Applies to:{" "}
                  <span className="font-mono">
                    {mod.appliesToCategories
                      ? `${mod.appliesToCategories.length} kategori`
                      : "semua kategori"}
                  </span>
                </p>
                {canUpdate || canDelete ? (
                  <div className="mt-3 flex justify-end gap-2 border-t border-neutral-100 pt-3">
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFormMode({ kind: "edit", modifier: mod })
                        }
                      >
                        <Pencil className="size-4" aria-hidden /> Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(mod)}
                        aria-label={`Hapus ${mod.label}`}
                      >
                        <Trash2 className="size-4 text-danger-500" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ModifierFormModal
        open={formMode !== null}
        mode={formMode}
        categories={categories}
        onClose={() => setFormMode(null)}
        onSaved={() => {
          setFormMode(null);
          refresh();
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Modifier?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              loading={deleting}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Hapus modifier <strong>{deleteTarget?.label}</strong> (
          <span className="font-mono">{deleteTarget?.slug}</span>)? Modifier
          yang dihapus tidak bisa dipulihkan.
        </p>
        <p className="mt-2 text-xs text-warning-500">
          ⚠ Transaksi historis yang sudah pakai modifier ini tetap intact
          (snapshot di transaksi tidak ke-edit).
        </p>
      </Modal>
    </div>
  );
}
