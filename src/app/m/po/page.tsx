"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  History,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button, Input, Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  createPurchaseRequest,
  listPurchaseRequests,
  listRequestableIngredients,
} from "@/features/purchase-requests/actions";
import {
  isOk,
  type PurchaseRequestWithItems,
  type RequestableIngredient,
} from "@/features/purchase-requests/types";
import { formatIndonesianDate } from "@/lib/date";
import { parseIndonesianNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  convertQtyWithIngredientPacks,
  displayUnit,
  mergePackConversions,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";

/** Sesi AE-190 — batas baris hasil pencarian yang dirender di layar HP. */
const MAX_VISIBLE_INGREDIENTS = 50;

interface ItemDraft {
  id: string;
  ingredientName: string;
  /** Satuan yang DIPILIH staff (boleh ≠ master, mis. Pcs untuk Bumbu Kentang
   *  yang master-nya gr). Untuk linked item, dikonversi ke master saat submit. */
  unit: string;
  /** Master/COGS unit untuk linked item (basis konversi). null = manual. */
  masterUnit: string | null;
  qty: string; // user-typed string for flexible decimal entry
  notes: string;
  /** Dipilih dari master bahan (bukan diketik manual). Sesi AE-190 — dulu
   *  bernama `fromLowStock` karena daftar pilihannya memang cuma low-stock. */
  fromMaster: boolean;
  ingredientId?: string; // null for custom items (added manually)
  /* Sesi AE-177d — pack conversions per-bahan + tier belanja → dipakai
   * client buat bangun dropdown satuan KANONIK (sama dgn Opname) +
   * konversi qty ke master sebelum submit. Null = manual item. */
  packConversions?: IngredientPackConversion[] | null;
  unitBelanja?: string | null;
  unitBelanjaPerCogs?: string | null;
}

/**
 * Sesi AD-10 — Purchase Order mobile module.
 *
 * Flow:
 *   1. Auth check via NextAuth session.
 *   2. Fetch SELURUH bahan aktif via listRequestableIngredients() — sesi
 *      AE-190. Dulu `listLowStockIngredients()`, yang bikin ~60% master bahan
 *      tidak pernah bisa ditemukan staff.
 *   3. Karyawan can:
 *      - Toggle bahan on/off (low-stock auto-fill suggestedQty)
 *      - Cari bahan apa pun dari master lewat kotak pencarian
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
      router.replace("/m/login");
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
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  /* Sesi AE-190 — SEMUA bahan aktif master, bukan cuma yang low-stock. */
  const [catalog, setCatalog] = useState<RequestableIngredient[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    requestNumber: string;
    waLink: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  // Sesi AE-15 — own PR history (staff scope).
  const [tab, setTab] = useState<"buat" | "riwayat">("buat");
  const [history, setHistory] = useState<PurchaseRequestWithItems[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listRequestableIngredients();
      if (cancelled) return;
      if (isOk(res)) {
        setCatalog(res.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setHistoryLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listPurchaseRequests({ onlyMine: true, limit: 30 });
      if (cancelled) return;
      if (isOk(res)) setHistory(res.data.items);
      setHistoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [historyKey]);

  const lowStockCount = useMemo(
    () => catalog.filter((i) => i.isLowStock).length,
    [catalog],
  );

  /* Sesi AE-190 — pencarian menjangkau SELURUH master bahan.
   *
   * Sebelumnya daftar & pencarian cuma jalan di hasil low-stock, jadi bahan
   * yang stoknya masih aman (Oreo, Regal, Nugget 500gr, …) atau yang belum
   * punya Stok Minimum tidak pernah ketemu dan staff terpaksa ketik manual.
   *
   * Tanpa kata kunci: tampilkan saran low-stock saja supaya layar HP tidak
   * kebanjiran 180+ baris. Begitu staff mengetik, cari ke semua bahan. */
  const matchedIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog.filter((i) => i.isLowStock);
    return catalog.filter((i) => i.name.toLowerCase().includes(q));
  }, [catalog, search]);

  /* Layar HP — batasi baris yang dirender biar kueri pendek (mis. "a") tidak
   * memuntahkan 180 baris. Server sudah mengurutkan low-stock duluan, jadi
   * yang terpotong adalah yang paling tidak mendesak. */
  const visibleIngredients = useMemo(
    () => matchedIngredients.slice(0, MAX_VISIBLE_INGREDIENTS),
    [matchedIngredients],
  );
  const hiddenCount = matchedIngredients.length - visibleIngredients.length;

  function isSelected(ingredientId: string) {
    return items.some((it) => it.ingredientId === ingredientId);
  }

  function toggleIngredient(ing: RequestableIngredient) {
    setItems((prev) => {
      const existing = prev.find((it) => it.ingredientId === ing.id);
      if (existing) {
        return prev.filter((it) => it.id !== existing.id);
      }
      return [
        ...prev,
        {
          id: `master-${ing.id}`,
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: displayUnit(ing.unit),
          masterUnit: displayUnit(ing.unit),
          qty: String(ing.suggestedQty),
          notes: "",
          fromMaster: true,
          packConversions: ing.packConversions,
          unitBelanja: ing.unitBelanja,
          unitBelanjaPerCogs: ing.unitBelanjaPerCogs,
        },
      ];
    });
  }

  function addCustomItem(prefillName = "") {
    setItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        ingredientName: prefillName,
        unit: "Pcs",
        masterUnit: null,
        qty: "",
        notes: "",
        fromMaster: false,
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
      /* Sesi AE-136 — strict Indonesian parser. */
      const qty = parseIndonesianNumber(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(
          `Qty untuk ${name} invalid. Pakai koma untuk desimal (mis. 0,5).`,
        );
        return;
      }
      /* Sesi AE-177d — kalau staff pilih satuan ≠ master (linked item),
       * konversi qty ke master pakai packConversions yg sama dgn Opname.
       * Hasil disimpan dalam satuan MASTER supaya alur PR→PO→GR konsisten
       * (Tarik PR akan baca outstanding dalam master + tampilkan di satuan
       * belanja owner). Manual item: kirim apa adanya. */
      let finalQty = qty;
      let finalUnit = it.unit.trim() || "pcs";
      const master = it.masterUnit ? displayUnit(it.masterUnit) : null;
      if (it.ingredientId && master) {
        const chosen = displayUnit(it.unit);
        if (chosen && chosen !== master) {
          const merged = mergePackConversions(
            (it.packConversions ?? []) as IngredientPackConversion[],
            it.unitBelanja && it.unitBelanjaPerCogs
              ? [
                  {
                    unitLabel: it.unitBelanja,
                    qtyPerBase: parseFloat(it.unitBelanjaPerCogs),
                  },
                ]
              : [],
          );
          const conv = convertQtyWithIngredientPacks(qty, chosen, master, merged);
          if (!conv.ok || conv.qtyMaster === null || conv.qtyMaster <= 0) {
            toast.error(
              `${name}: tidak bisa konversi ${chosen} ke ${master}. Pilih satuan lain atau minta owner set Konversi Pack di Kelola Bahan.`,
            );
            return;
          }
          finalQty = conv.qtyMaster;
        }
        finalUnit = master;
      }
      validatedItems.push({
        ingredientId: it.ingredientId ?? null,
        ingredientName: name,
        unit: finalUnit,
        requestedQty: finalQty,
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
        // Sesi AE-16 — null untuk manual items (no master FK). Linked
        // items kirim ingredientId dari master. Server resolve snapshot.
        ingredientId: v.ingredientId ?? null,
        ingredientNameSnapshot: v.ingredientName,
        unitSnapshot: v.unit,
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
      session?.user.name ?? "Karyawan",
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

      {/* Sesi AE-15 — Tabs Buat Baru | Riwayat */}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-neutral-100 p-1.5">
        <button
          type="button"
          onClick={() => setTab("buat")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors",
            tab === "buat"
              ? "bg-white text-mahakan-green-900 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          <Plus className="size-4" aria-hidden /> Buat Baru
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("riwayat");
            setHistoryKey((k) => k + 1);
          }}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors",
            tab === "riwayat"
              ? "bg-white text-mahakan-green-900 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          <History className="size-4" aria-hidden /> Riwayat
          {history.length > 0 ? (
            <span className="ml-1 rounded-full bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold text-mahakan-green-900">
              {history.length}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "riwayat" ? (
        <PrHistorySection
          loading={historyLoading}
          history={history}
          onRefresh={() => setHistoryKey((k) => k + 1)}
        />
      ) : null}

      {tab !== "buat" ? null : (
      <>
      {/* Sesi AE-190 — pemilih bahan dari SELURUH master. Section ini selalu
       *  dirender: dulu digerbangi `lowStock.length > 0`, jadi saat tidak ada
       *  bahan low-stock kotak pencariannya ikut hilang total. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
            {search.trim() ? "Hasil Pencarian" : "Stok Menipis — Saran Otomatis"}
          </h2>
          <span className="text-[11px] text-neutral-600">
            {items.filter((i) => i.fromMaster).length} dipilih
          </span>
        </div>
        <Input
          type="text"
          size="lg"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Cari dari ${catalog.length} bahan…`}
          leadingIcon={<Search className="size-4" aria-hidden />}
          className="mb-2"
        />
        {!search.trim() ? (
          <p className="mb-2 text-[11px] text-neutral-600">
            {lowStockCount > 0
              ? `${lowStockCount} bahan stoknya menipis. `
              : "Belum ada bahan yang stoknya menipis. "}
            Bahan lain tetap bisa diminta — ketik namanya di kotak pencarian.
          </p>
        ) : null}
        <ul className="space-y-2">
          {visibleIngredients.length === 0 ? (
            <li className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-center">
              <p className="text-xs text-neutral-600">
                {search.trim()
                  ? `“${search.trim()}” tidak ada di daftar bahan.`
                  : "Belum ada bahan yang stoknya menipis."}
              </p>
              {search.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    addCustomItem(search.trim());
                    setSearch("");
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-mahakan-green-50 px-3 py-2 text-xs font-semibold text-mahakan-green-700"
                >
                  <Plus className="size-3.5" aria-hidden /> Tambah &ldquo;
                  {search.trim()}&rdquo; manual
                </button>
              ) : null}
            </li>
          ) : (
            visibleIngredients.map((ing) => (
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
                  onClick={() => toggleIngredient(ing)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold text-neutral-900">
                        {ing.name}
                      </p>
                      {ing.isLowStock ? (
                        <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-700">
                          Menipis
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-neutral-600">
                      Stok: {ing.currentStock} {ing.unit}
                      {ing.isLowStock
                        ? ` · Stok Min: ${ing.reorderThreshold} ${ing.unit}`
                        : ""}
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
        {hiddenCount > 0 ? (
          <p className="mt-2 text-center text-[11px] text-neutral-600">
            +{hiddenCount} bahan lain cocok. Ketik lebih lengkap buat
            mempersempit.
          </p>
        ) : null}
      </section>

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
                  {it.fromMaster ? (
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
                  {/* Sesi AE-177d — dropdown satuan KANONIK (= Opname /
                   * Market List). Linked item: opsi = master + belanja +
                   * packConversions + presets (staff boleh pilih Pcs/renceng
                   * dll kalau master sudah set Konversi Pack). Manual item:
                   * cuma presets canonical. */}
                  <select
                    value={displayUnit(it.unit)}
                    onChange={(e) => updateItem(it.id, { unit: e.target.value })}
                    className="w-24 shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 focus:border-mahakan-green-700 focus:outline-none"
                    aria-label="Satuan"
                  >
                    {buildUnitSelectOptions({
                      presets: CANONICAL_UNIT_PRESETS,
                      packLabels: it.fromMaster
                        ? [
                            it.masterUnit ?? "",
                            it.unitBelanja ?? "",
                            ...((it.packConversions ?? []).map(
                              (p) => p.unitLabel,
                            )),
                          ]
                        : [],
                      current: it.unit,
                    }).options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {it.fromMaster &&
                it.masterUnit &&
                displayUnit(it.unit) !== it.masterUnit ? (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Disimpan dlm satuan dasar:{" "}
                    <span className="font-mono">{it.masterUnit}</span> (otomatis
                    dikonversi)
                  </p>
                ) : null}
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
        onClick={() => addCustomItem()}
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
      </>
      )}
    </div>
  );
}

// ============================================================
// Sesi AE-15 — PR history section (own scope)
// ============================================================

function PrHistorySection({
  loading,
  history,
  onRefresh,
}: {
  loading: boolean;
  history: PurchaseRequestWithItems[];
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center text-sm text-neutral-500">
        <Spinner className="mx-auto size-5 text-mahakan-green-700" />
      </div>
    );
  }
  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
        <ClipboardList
          className="mx-auto mb-2 size-6 text-neutral-400"
          aria-hidden
        />
        Belum ada permintaan belanja yang kamu buat.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-neutral-600">
          {history.length} permintaan terakhir
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="text-[11px] text-mahakan-green-700 hover:underline"
        >
          Refresh
        </button>
      </div>
      <ul className="space-y-2">
        {history.map((pr) => (
          <PrHistoryCard key={pr.id} pr={pr} />
        ))}
      </ul>
    </div>
  );
}

function qtyOf(item: {
  requestedQty: number;
  requestedQtyDecimal: string | null;
}): number {
  return item.requestedQtyDecimal !== null
    ? parseFloat(item.requestedQtyDecimal)
    : Number(item.requestedQty);
}
function recvOf(item: {
  receivedQty: number;
  receivedQtyDecimal: string | null;
}): number {
  return item.receivedQtyDecimal !== null
    ? parseFloat(item.receivedQtyDecimal)
    : Number(item.receivedQty);
}

function PrHistoryCard({ pr }: { pr: PurchaseRequestWithItems }) {
  const totalRequested = pr.items.reduce((s, it) => s + qtyOf(it), 0);
  const totalReceived = pr.items.reduce((s, it) => s + recvOf(it), 0);
  const fulfillPercent =
    totalRequested > 0
      ? Math.round((totalReceived / totalRequested) * 100)
      : 0;
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);

  const statusMap: Record<
    string,
    { label: string; bg: string; text: string }
  > = {
    open: {
      label: "Belum Dipenuhi",
      bg: "bg-warning-100",
      text: "text-warning-700",
    },
    partial: {
      label: "Sebagian",
      bg: "bg-info-100",
      text: "text-info-500",
    },
    completed: {
      label: "Selesai",
      bg: "bg-mahakan-green-100",
      text: "text-mahakan-green-900",
    },
    cancelled: {
      label: "Dibatalkan",
      bg: "bg-neutral-100",
      text: "text-neutral-600",
    },
  };
  const status = statusMap[pr.status] ?? statusMap.open;

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">
            PR-{pr.id.slice(0, 8)}
          </p>
          <p className="text-[11px] text-neutral-600">
            {formatIndonesianDate(pr.createdAt)} · {pr.items.length} item
            {pr.whatsappSentAt ? " · WA terkirim" : ""}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            status.bg,
            status.text,
          )}
        >
          {status.label}
        </span>
      </div>

      {totalRequested > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-neutral-700">
            <span>Pemenuhan</span>
            <span className="font-mono font-semibold">
              {fulfillPercent}% ({fmt(totalReceived)}/{fmt(totalRequested)})
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className={cn(
                "h-full transition-all",
                fulfillPercent === 100
                  ? "bg-mahakan-green-700"
                  : fulfillPercent > 0
                    ? "bg-info-400"
                    : "bg-warning-400",
              )}
              style={{ width: `${Math.min(100, fulfillPercent)}%` }}
            />
          </div>
        </div>
      ) : null}

      <ul className="mt-2 space-y-0.5">
        {pr.items.slice(0, 3).map((it) => (
          <li
            key={it.id}
            className="flex items-baseline justify-between text-[11px] text-neutral-700"
          >
            <span className="truncate">{it.ingredientNameSnapshot}</span>
            <span className="ml-2 shrink-0 font-mono">
              {fmt(recvOf(it))}/{fmt(qtyOf(it))} {it.unitSnapshot}
            </span>
          </li>
        ))}
        {pr.items.length > 3 ? (
          <li className="text-[11px] italic text-neutral-500">
            +{pr.items.length - 3} item lain
          </li>
        ) : null}
      </ul>

      {pr.status === "cancelled" && pr.cancelReason ? (
        <p className="mt-1.5 rounded-md bg-neutral-50 px-2 py-1 text-[11px] italic text-neutral-700">
          Alasan batal: {pr.cancelReason}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Sesi AE-18 — WA message format upgrade. Owner feedback: pesan terlalu
 * minim, butuh info lengkap. Tambah:
 *   - Tanggal + jam WIB
 *   - Nama pemohon (kasir)
 *   - Total item count
 *   - Format qty dengan locale id-ID + max 4 decimal
 *   - Per-item notes kalau ada
 *   - Catatan global (sudah ada)
 *   - Branded footer dengan link WhatsApp instructions
 */
function buildWaMessage(
  reqNumber: string,
  items: Array<{
    ingredientName: string;
    unit: string;
    requestedQty: number;
    notes?: string | null;
  }>,
  notes: string,
  requesterName: string,
): string {
  const fmtQty = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);
  const dateStr = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date());
  const timeStr = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  const lines = [
    `🛒 *PERMINTAAN BELANJA — MAHAKAN*`,
    ``,
    `📋 No. PR  : *${reqNumber}*`,
    `📅 Tanggal : ${dateStr}`,
    `⏰ Jam     : ${timeStr} WIB`,
    `👤 Diminta : ${requesterName}`,
    `📦 Item    : ${items.length} bahan`,
    ``,
    `*— DAFTAR BELANJA —*`,
  ];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    lines.push(`${i + 1}. ${it.ingredientName} — ${fmtQty(it.requestedQty)} ${it.unit}`);
    if (it.notes && it.notes.trim().length > 0) {
      lines.push(`   _↳ ${it.notes.trim()}_`);
    }
  }
  if (notes.trim()) {
    lines.push("", `*— CATATAN —*`, notes.trim());
  }
  lines.push(
    "",
    `─────────────────────`,
    `_Pesan otomatis dari Mahakan POS Mobile_`,
    `_Konfirmasi approval atau pertanyaan: balas pesan ini_`,
  );
  return lines.join("\n");
}

function buildWaLink(message: string): string {
  // wa.me universal link — no specific phone, user picks contact
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
