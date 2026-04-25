"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { isOk, menuService } from "@/mocks/services";
import type { Modifier } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";

const EDITABLE_SLUGS = new Set(["extra_shot", "extra_topping_ayam"]);

export function ModifiersConfig() {
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Modifier | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await menuService.listModifiers();
      if (cancelled) return;
      if (isOk(res)) setModifiers(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function handleSave() {
    if (!editing || submitting) return;
    const price = parseInt(priceInput, 10);
    if (Number.isNaN(price)) {
      setError("Harga harus angka");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await menuService.updateModifierPrice(editing.slug, price);
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Harga modifier disimpan");
    setEditing(null);
    setPriceInput("");
    setSubmitting(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">
          Modifier ({modifiers.length})
        </h2>
        <p className="text-xs text-neutral-500">
          Sugar/Ice level bersifat fixed (free). Hanya Extra Shot &amp; Extra
          Topping Ayam yang bisa di-edit harganya.
        </p>
      </header>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2" role="status" aria-label="Memuat modifier">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {modifiers.map((mod) => {
            const editable = EDITABLE_SLUGS.has(mod.slug);
            return (
              <Card key={mod.slug}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{mod.label}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {mod.slug}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={mod.type === "toggle" ? "info" : "neutral"}
                    >
                      {mod.type}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {mod.type === "toggle" ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-neutral-500">Harga</p>
                        <p className="font-mono text-lg font-bold text-neutral-900">
                          +{formatRupiah(mod.price)}
                        </p>
                      </div>
                      {editable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(mod);
                            setPriceInput(String(mod.price));
                            setError(null);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden /> Edit
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      <p className="mb-1 text-xs text-neutral-500">Pilihan</p>
                      <div className="flex flex-wrap gap-1.5">
                        {mod.options?.map((opt) => (
                          <Badge key={opt.value} variant="neutral">
                            {opt.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {mod.appliesToCategories ? (
                    <p className="mt-3 text-xs text-neutral-500">
                      Applies to:{" "}
                      <span className="font-mono">
                        {mod.appliesToCategories.length} kategori
                      </span>
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-neutral-500">
                      Applies to: semua kategori
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          setPriceInput("");
          setError(null);
        }}
        title={editing ? `Edit ${editing.label}` : "Edit Modifier"}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setPriceInput("");
                setError(null);
              }}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleSave} loading={submitting}>
              Simpan
            </Button>
          </>
        }
      >
        <Input
          label="Harga (rupiah)"
          type="text"
          inputMode="numeric"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value.replace(/[^\d]/g, ""))}
          autoFocus
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
