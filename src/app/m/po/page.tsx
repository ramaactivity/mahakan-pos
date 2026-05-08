"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button, Input, Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  createPurchaseRequest,
  listLowStockIngredients,
} from "@/features/purchase-requests/actions";
import { isOk, type LowStockIngredient } from "@/features/purchase-requests/types";
import { cn } from "@/lib/utils";

interface ItemDraft {
  id: string;
  ingredientName: string;
  unit: string;
  qty: string; // user-typed string for flexible decimal entry
  notes: string;
  fromLowStock: boolean;
  ingredientId?: string; // null for custom items (added manually)
}

/**
 * Sesi AD-10 — Purchase Order mobile module.
 *
 * Flow:
 *   1. Auth check via NextAuth session.
 *   2. Fetch low-stock ingredients via listLowStockIngredients().
 *   3. Karyawan can:
 *      - Toggle low-stock items on/off (auto-fill suggestedQty)
 *      - Adjust qty per item
 *      - Add custom item manually (text input + qty)
 *      - Add catatan global
 *   4. Submit → createPurchaseRequest. Mobile context = no shiftId.
 *   5. After success: show WhatsApp deeplink to owner with pre-filled
 *      message summarizing items.
 */
export default function MobilePoPage() {
  const router = useRouter();
  const { session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/pin");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return null;
  }

  return <PoView />;
}

function PoView() {
  const [loading, setLoading] = useState(true);
  const [lowStock, setLowStock] = useState<LowStockIngredient[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    requestNumber: string;
    waLink: string;
  } | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listLowStockIngredients();
      if (cancelled) return;
      if (isOk(res)) {
        setLowStock(res.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredLowStock = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lowStock;
    return lowStock.filter((i) => i.name.toLowerCase().includes(q));
  }, [lowStock, search]);

  function isSelected(ingredientId: string) {
    return items.some((it) => it.ingredientId === ingredientId);
  }

  function toggleLowStockItem(ing: LowStockIngredient) {
    setItems((prev) => {
      const existing = prev.find((it) => it.ingredientId === ing.id);
      if (existing) {
        return prev.filter((it) => it.id !== existing.id);
      }
      return [
        ...prev,
        {
          id: `low-${ing.id}`,
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          qty: String(ing.suggestedQty),
          notes: "",
          fromLowStock: true,
        },
      ];
    });
  }

  function addCustomItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        ingredientName: "",
        unit: "pcs",
        qty: "",
        notes: "",
        fromLowStock: false,
      },
    ]);
  }

  function updateItem(id: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleSubmit() {
    if (submitting) return;

    // Validate items
    const validatedItems: Array<{
      ingredientId: string | null;
      ingredientName: string;
      unit: string;
      requestedQty: number;
      notes: string | null;
    }> = [];
    for (const it of items) {
      const name = it.ingredientName.trim();
      if (!name) {
        toast.error("Nama bahan tidak boleh kosong");
        return;
      }
      const qty = parseFloat(it.qty.replace(",", "."));
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(`Qty untuk ${name} tidak valid`);
        return;
      }
      validatedItems.push({
        ingredientId: it.ingredientId ?? null,
        ingredientName: name,
        unit: it.unit.trim() || "pcs",
        requestedQty: qty,
        notes: it.notes.trim() || null,
      });
    }

    if (validatedItems.length === 0) {
      toast.error("Pilih minimal 1 item");
      return;
    }

    setSubmitting(true);
    const res = await createPurchaseRequest({
      shiftId: null,
      notes: notes.trim() || null,
      items: validatedItems.map((v) => ({
        ingredientId: v.ingredientId ?? "",
        ingredientName: v.ingredientName,
        unit: v.unit,
        requestedQty: v.requestedQty,
        notes: v.notes ?? undefined,
      })),
    });

    setSubmitting(false);

    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }

    // Build WhatsApp deeplink message
    const message = buildWaMessage(
      `REQ-${res.data.id.slice(0, 8).toUpperCase()}`,
      validatedItems,
      notes,
    );
    const waLink = buildWaLink(message);

    setSubmitResult({
      requestNumber: `REQ-${res.data.id.slice(0, 8).toUpperCase()}`,
      waLink,
    });
    toast.success("Permintaan belanja tersimpan");
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  if (submitResult) {
    return (
      <div className="space-y-4">
        <header className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-success-100 text-success-500">
            <CheckCircle2 className="size-8" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">
            Permintaan Tersimpan
          </h1>
          <p className="font-mono text-xs text-neutral-600">
            {submitResult.requestNumber}
          </p>
        </header>

        <div className="rounded-xl border border-info-300 bg-info-100 p-4 text-sm text-info-500">
          <p className="font-semibold">Kirim ke Owner via WhatsApp</p>
          <p className="mt-1 text-xs text-neutral-700">
            Tap tombol di bawah untuk buka WhatsApp dengan pesan terisi
            otomatis. Owner approve → Manager belanja.
          </p>
        </div>

        <a
          href={submitResult.waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md bg-success-500 px-5 py-3 text-center text-base font-medium text-white transition-colors hover:bg-success-500/90 active:scale-95"
        >
          Buka WhatsApp
        </a>

        <Link
          href="/m"
          className="block rounded-md border border-neutral-300 bg-white px-5 py-3 text-center text-base font-medium text-neutral-900 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
        >
          Selesai
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/m"
        className="inline-flex items-center gap-2 text-sm text-mahakan-green-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke menu
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-mahakan-green-700" aria-hidden />
          <h1 className="text-lg font-bold text-mahakan-green-900">
            Purchase Order
          </h1>
        </div>
        <p className="text-sm text-neutral-700">
          Pilih bahan low-stock atau tambah manual. Kirim ke Owner via
          WhatsApp setelah submit.
        </p>
      </header>

      {/* Low stock auto-suggestions */}
      {lowStock.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
              Low-stock — Auto-suggest
            </h2>
            <span className="text-[11px] text-neutral-600">
              {items.filter((i) => i.fromLowStock).length} dipilih
            </span>
          </div>
          <Input
            type="text"
            size="lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari bahan…"
            leadingIcon={<Search className="size-4" aria-hidden />}
            className="mb-2"
          />
          <ul className="space-y-2">
            {filteredLowStock.length === 0 ? (
              <li className="rounded-lg border border-dashed border-neutral-300 bg-white py-4 text-center text-xs text-neutral-600">
                Tidak ada hasil untuk &ldquo;{search}&rdquo;.
              </li>
            ) : (
              filteredLowStock.map((ing) => (
                <li
                  key={ing.id}
                  className={cn(
                    "rounded-lg border bg-white p-3 transition-colors",
                    isSelected(ing.id)
                      ? "border-mahakan-green-700 bg-mahakan-green-50"
                      : "border-neutral-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleLowStockItem(ing)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-neutral-900">
                        {ing.name}
                      </p>
                      <p className="text-[11px] text-neutral-600">
                        Stok: {ing.currentStock} {ing.unit} · Threshold:{" "}
                        {ing.reorderThreshold} {ing.unit}
                        {ing.section ? (
                          <span className="ml-1 text-neutral-500">
                            · {ing.section}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
                        isSelected(ing.id)
                          ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                          : "border-neutral-300",
                      )}
                    >
                      {isSelected(ing.id) ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : null}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {/* Custom items + selected items qty editor */}
      {items.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
            Items dipilih ({items.length})
          </h2>
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-lg border border-neutral-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  {it.fromLowStock ? (
                    <p className="flex-1 text-sm font-semibold text-neutral-900">
                      {it.ingredientName}
                    </p>
                  ) : (
                    <input
                      type="text"
                      value={it.ingredientName}
                      onChange={(e) =>
                        updateItem(it.id, { ingredientName: e.target.value })
                      }
                      placeholder="Nama bahan"
                      className="flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="size-8 shrink-0 rounded-md text-danger-500 transition-colors hover:bg-danger-100"
                    aria-label={`Hapus ${it.ingredientName}`}
                  >
                    <Trash2 className="mx-auto size-4" aria-hidden />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => updateItem(it.id, { qty: e.target.value })}
                    placeholder="Qty"
                    className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-mono tabular-nums text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none"
                  />
                  {it.fromLowStock ? (
                    <span className="shrink-0 text-sm font-medium text-neutral-700">
                      {it.unit}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={it.unit}
                      onChange={(e) => updateItem(it.id, { unit: e.target.value })}
                      placeholder="unit"
                      className="w-20 shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 focus:border-mahakan-green-700 focus:outline-none"
                    />
                  )}
                </div>
                <input
                  type="text"
                  value={it.notes}
                  onChange={(e) => updateItem(it.id, { notes: e.target.value })}
                  placeholder="Catatan per item (opsional)"
                  className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        onClick={addCustomItem}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-mahakan-green-700 transition-colors hover:border-mahakan-green-700 hover:bg-mahakan-green-50"
      >
        <Plus className="size-4" aria-hidden /> Tambah Item Manual
      </button>

      <div>
        <label className="block text-sm font-medium text-neutral-900">
          Catatan Permintaan (opsional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Misal: butuh hari ini, ambil di toko sebelah gudang"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
        />
      </div>

      <Button
        size="lg"
        fullWidth
        onClick={handleSubmit}
        loading={submitting}
        disabled={submitting || items.length === 0}
      >
        {submitting
          ? "Menyimpan…"
          : `Submit ${items.length > 0 ? `(${items.length} item)` : ""}`}
      </Button>
    </div>
  );
}

function buildWaMessage(
  reqNumber: string,
  items: Array<{ ingredientName: string; unit: string; requestedQty: number }>,
  notes: string,
): string {
  const lines = [
    `*Permintaan Belanja — Mahakan*`,
    `No: ${reqNumber}`,
    ``,
    ...items.map(
      (it, i) =>
        `${i + 1}. ${it.ingredientName} — ${it.requestedQty} ${it.unit}`,
    ),
  ];
  if (notes.trim()) {
    lines.push("", `Catatan: ${notes.trim()}`);
  }
  lines.push("", `_Dikirim dari Mahakan POS Mobile_`);
  return lines.join("\n");
}

function buildWaLink(message: string): string {
  // wa.me universal link — no specific phone, user picks contact
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
