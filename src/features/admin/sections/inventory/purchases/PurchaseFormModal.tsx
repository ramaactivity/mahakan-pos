"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  createPurchase,
  isOk,
  type PaymentMethod,
} from "@/features/purchases";
import {
  listAtomicIngredients,
  type Ingredient,
} from "@/features/inventory";
import { isOk as inventoryIsOk } from "@/features/inventory";
import {
  listSuppliers,
  isOk as suppliersIsOk,
  type Supplier,
} from "@/features/suppliers";
import { lookupMarketPriceForPurchase } from "@/features/market-list";
import { getLastFinalizedOpname } from "@/features/stock-opname";
import { formatRupiah, parseRupiah } from "@/lib/format";
import {
  classifyPurchaseAgainstOpname,
  convertPurchaseQty,
  convertQty,
  jakartaDateIso,
  resolveUnit,
  scaleCostOnUnitChange,
  shouldSkipStockUpdate,
  type BackdateStatus,
  type IngredientPackConversion,
  type PackInfo,
} from "@/lib/unit-conversion";
import { cn } from "@/lib/utils";

interface PurchaseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Sesi AE-129 — cap multi-nota di 5. Cukup untuk skenario worst-case
 * Anisa (belanja 3-4 toko sekaligus) tapi cegah abuse Drive folder. */
const MAX_RECEIPTS = 5;

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "Transfer BCA" },
  { value: "transfer_bri", label: "Transfer BRI" },
  { value: "transfer_other", label: "Transfer lain" },
  { value: "top", label: "TOP (kredit)" },
];

interface ItemRow {
  id: string;
  ingredientId: string;
  qty: string;
  unit: string;
  unitCost: string;
  /** Sesi AE-78 — dual-input "smart math" mirror Google Sheets. User bisa
   * input EITHER harga per satuan atau total bayar; sistem auto-derive
   * yang lain. `inputMode` tracks mana yang user-typed (source of truth):
   *   - "unit": user input unitCost (default), total = qty × unitCost
   *   - "total": user input total, unitCost = total ÷ qty (mirror sheets
   *     pattern Anisa — dia type total, harga per Kg auto-derive)
   * `total` field stored UI-side, server tetap terima qty + unitCost. */
  inputMode: "unit" | "total";
  total: string;
}

function newRow(): ItemRow {
  return {
    id: Math.random().toString(36).slice(2),
    ingredientId: "",
    qty: "",
    unit: "",
    unitCost: "",
    inputMode: "unit",
    total: "",
  };
}

// Sesi AE — list satuan umum yang staff Mahakan biasa pakai. Master unit
// dari ingredient akan otomatis pre-select; staff bisa override per-line
// (mis. master "Kg", staff input "gr" untuk belanja kecil).
const COMMON_UNITS = [
  "Kg",
  "gr",
  "L",
  "ml",
  "Btl",
  "Pcs",
  "Packs",
  "Bks",
  "Krat",
  "Lusin",
  "Sdm",
  "Sdt",
  "Karton",
] as const;

/* Sesi AE-129 — localStorage draft autosave. Anisa feedback: saat sedang
 * catat pembelian sering perlu keluar modal untuk tambah ingredient ke
 * Market List dulu — data form ke-reset semua. Draft autosave (debounced
 * 500ms) supaya kalau modal ke-close (Esc, click backdrop, refresh tab),
 * data tetap di-restore saat reopen.
 *
 * Storage scope: per browser (localStorage). Per outlet pelan-pelan kita
 * tambahkan kalau perlu — saat ini staff Mahakan masing-masing per device
 * jadi cukup. Edit mode tidak ada (form ini create-only). */
const DRAFT_STORAGE_KEY = "mahakan:purchase-draft:v1";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — kemungkinan staff sudah lupa

interface PurchaseDraftPayload {
  supplierId: string | null;
  directMode: boolean;
  directPlace: string;
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  paymentTerm: string;
  invoiceNo: string;
  notes: string;
  receipts: Array<{ url: string; name: string }>;
  updateCost: boolean;
  createKas: boolean;
  items: ItemRow[];
  savedAt: number;
}

function loadDraft(): PurchaseDraftPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PurchaseDraftPayload;
    /* Drop draft > 24 jam (stale, kemungkinan staff sudah lupa). */
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(payload: Omit<PurchaseDraftPayload, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ ...payload, savedAt: Date.now() }),
    );
  } catch {
    /* localStorage full/disabled — silently skip (draft is best-effort). */
  }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* Treshold "ada isinya" — minimal 1 item dengan ingredient ter-pilih ATAU
 * field metadata di-set (invoice / place / notes / receipts). Tanpa ini,
 * draft kosong (modal di-open lalu di-close tanpa input) akan muncul
 * banner restore yang membingungkan. */
function isDraftMeaningful(d: PurchaseDraftPayload | null): boolean {
  if (!d) return false;
  const hasItem = d.items.some(
    (i) =>
      i.ingredientId.trim() !== "" ||
      i.qty.trim() !== "" ||
      i.unitCost.trim() !== "",
  );
  return (
    hasItem ||
    d.invoiceNo.trim() !== "" ||
    d.notes.trim() !== "" ||
    d.directPlace.trim() !== "" ||
    d.receipts.length > 0
  );
}

/* Ringkasan singkat untuk display di banner restore. */
function draftSummary(d: PurchaseDraftPayload): string {
  const itemsWithIngredient = d.items.filter(
    (i) => i.ingredientId.trim() !== "",
  ).length;
  const parts: string[] = [];
  if (itemsWithIngredient > 0) parts.push(`${itemsWithIngredient} item`);
  if (d.receipts.length > 0) parts.push(`${d.receipts.length} nota`);
  if (d.invoiceNo.trim()) parts.push(`invoice ${d.invoiceNo.trim()}`);
  if (d.directMode && d.directPlace.trim())
    parts.push(`@ ${d.directPlace.trim()}`);
  return parts.length > 0 ? parts.join(" · ") : "draft kosong";
}

function buildUnitOptions(
  masterUnit: string | undefined,
  ingredientPacks?: IngredientPackConversion[] | null,
): Array<{ value: string; label: string }> {
  const set = new Set<string>(COMMON_UNITS);
  if (masterUnit) set.add(masterUnit);
  /* Sesi AE-62af — include ingredient-scoped pack conversions (mis. "packs"
   * untuk Lychee Kaleng yang master pcs). Tanpa ini, staff tidak bisa pilih
   * "packs" saat catat pembelian walau sudah set di Edit Satuan Bahan. */
  if (ingredientPacks && ingredientPacks.length > 0) {
    for (const p of ingredientPacks) {
      const label = p.unitLabel.trim();
      if (label.length > 0) set.add(label);
    }
  }
  return Array.from(set).map((u) => ({ value: u, label: u }));
}

function parseQtyDecimal(s: string): number {
  // Accept koma OR titik sebagai decimal separator (staff Indo biasa pakai
  // koma di Sheets). Strip whitespace + non-numeric kecuali separator.
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Sesi AE-78 — Parse total bayar (rupiah). Accept "10.000", "10000", "Rp 10.000". */
function parseTotalSafe(s: string): number {
  const cleaned = s.trim().replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatQtyForDisplay(n: number): string {
  // Tampilan: integer tanpa decimal, decimal dipotong trailing zero.
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(4)));
}

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function PurchaseFormModal({
  open,
  onClose,
  onSaved,
}: PurchaseFormModalProps) {
  const [ingredientList, setIngredientList] = useState<Ingredient[]>([]);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [supplierId, setSupplierId] = useState<string | null>(null);
  // "Pembelian langsung" mode (sesi Z #4) — staff belanja mendadak di
  // warung/Alfamart/pasar yang BUKAN supplier listed. UI hides supplier
  // picker, surfaces a free-text "tempat belanja" input, and prepends
  // it to notes on save (no schema migration needed: supplier_id stays
  // nullable + tempat goes into notes).
  const [directMode, setDirectMode] = useState(false);
  const [directPlace, setDirectPlace] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayJakartaIso());
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [paymentTerm, setPaymentTerm] = useState("0");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  // Receipt upload (sesi AA #2). PDF allowed in addition to image —
  // bank/aggregator receipts often arrive as PDF.
  //
  // Sesi AE-129 — multi-nota (Anisa request). Staff sering belanja dari
  // beberapa toko, jadi satu purchase bisa punya >1 nota. Store sebagai
  // array of {url, name}; UI cap di MAX_RECEIPTS (5). Server tetap mirror
  // item pertama ke kolom legacy receiptImageUrl untuk backward compat
  // dengan list/detail views lama.
  const [receipts, setReceipts] = useState<
    Array<{ url: string; name: string }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updateCost, setUpdateCost] = useState(true);
  const [createKas, setCreateKas] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([newRow(), newRow()]);
  /* Sesi AE-43 — pack info dari Market List per ingredient. Dipakai
   * untuk live preview konversi (mis. "1 Pack = 1000 gr") + diteruskan
   * ke server lewat lookup di transaction. Key: ingredientId. */
  const [packByIngredient, setPackByIngredient] = useState<
    Map<string, PackInfo>
  >(() => new Map());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Sesi AE-129 — draft autosave (Anisa feedback). pendingDraft = draft di
   * localStorage yang siap di-restore saat user pilih "Restore" di banner. */
  const [pendingDraft, setPendingDraft] = useState<PurchaseDraftPayload | null>(
    null,
  );
  /* Sesi AE-130 — anti-double-count (Anisa feedback). Fetch opname terakhir
   * yang finalized supaya banner peringatan bisa muncul saat user pilih
   * tanggal belanja yang BACKDATED relative ke opname. Saat null (fresh
   * setup, Mahakan baru 3 minggu) → banner tidak pernah muncul, normal
   * additive behavior. */
  const [lastOpname, setLastOpname] = useState<{
    finalizedAtDate: Date;
    finalizedAtIso: string;
    periodLabel: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingMaster(true);
    setSupplierId(null);
    setDirectMode(false);
    setDirectPlace("");
    setPurchaseDate(todayJakartaIso());
    setPaymentMethod("cash");
    setPaymentTerm("0");
    setInvoiceNo("");
    setNotes("");
    setReceipts([]);
    setUploading(false);
    setUpdateCost(true);
    setCreateKas(true);
    setItems([newRow(), newRow()]);
    setPackByIngredient(new Map());
    setError(null);
    setSubmitting(false);
    /* Sesi AE-129 — cek apakah ada draft tersimpan. Banner restore akan
     * tampil di atas form kalau draft meaningful. */
    const draft = loadDraft();
    setPendingDraft(isDraftMeaningful(draft) ? draft : null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [ingRes, supRes, opnameRes] = await Promise.all([
        listAtomicIngredients({ activeOnly: true }),
        listSuppliers({ activeOnly: true }),
        getLastFinalizedOpname(),
      ]);
      if (cancelled) return;
      if (inventoryIsOk(ingRes)) setIngredientList(ingRes.data.items);
      if (suppliersIsOk(supRes)) setSupplierList(supRes.data);
      /* Sesi AE-130 — surface last opname info supaya banner backdate
       * bisa kompute di-client. opnameRes pakai ApiResult shape dari
       * stock-opname feature; success path. */
      if (opnameRes && "success" in opnameRes && opnameRes.success) {
        const data = opnameRes.data;
        if (data) {
          setLastOpname({
            finalizedAtDate: new Date(data.finalizedAtIso),
            finalizedAtIso: data.finalizedAtIso,
            periodLabel: data.periodLabel,
          });
        } else {
          setLastOpname(null);
        }
      }
      setLoadingMaster(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /* Sesi AE-129 — autosave draft saat user ngetik (debounced 500ms). Tidak
   * save kalau form kosong (no meaningful input) supaya banner restore tidak
   * muncul untuk modal yang sekedar di-open lalu di-close tanpa interaksi.
   *
   * Note: tidak save juga saat modal closed (`open=false`) supaya save action
   * tidak race dengan unmount/close.
   *
   * Snapshot dipakai untuk restore — termasuk receipts (URL Drive, bukan
   * file blob, jadi aman di-serialize) supaya staff tidak perlu re-upload
   * nota yang sudah masuk Drive. */
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const payload: Omit<PurchaseDraftPayload, "savedAt"> = {
        supplierId,
        directMode,
        directPlace,
        purchaseDate,
        paymentMethod,
        paymentTerm,
        invoiceNo,
        notes,
        receipts,
        updateCost,
        createKas,
        items,
      };
      // Use isDraftMeaningful with savedAt placeholder for check only.
      if (!isDraftMeaningful({ ...payload, savedAt: 0 })) return;
      saveDraft(payload);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    open,
    supplierId,
    directMode,
    directPlace,
    purchaseDate,
    paymentMethod,
    paymentTerm,
    invoiceNo,
    notes,
    receipts,
    updateCost,
    createKas,
    items,
  ]);

  /* Restore draft ke form state. Tidak refetch ingredient/supplier list —
   * sudah di-load di reset effect. */
  function applyDraft(d: PurchaseDraftPayload) {
    setSupplierId(d.supplierId);
    setDirectMode(d.directMode);
    setDirectPlace(d.directPlace);
    setPurchaseDate(d.purchaseDate);
    setPaymentMethod(d.paymentMethod);
    setPaymentTerm(d.paymentTerm);
    setInvoiceNo(d.invoiceNo);
    setNotes(d.notes);
    setReceipts(d.receipts);
    setUpdateCost(d.updateCost);
    setCreateKas(d.createKas);
    setItems(d.items);
    setPendingDraft(null);
  }

  function discardDraft() {
    clearDraft();
    setPendingDraft(null);
  }

  // When supplier changes, suggest default term + auto-switch payment method.
  useEffect(() => {
    if (!supplierId) return;
    const sup = supplierList.find((s) => s.id === supplierId);
    if (!sup) return;
    if (sup.defaultPaymentTermDays > 0) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPaymentMethod("top");
      setPaymentTerm(String(sup.defaultPaymentTermDays));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [supplierId, supplierList]);

  // Sync payment method ↔ term: TOP requires >0; non-TOP forces 0.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (paymentMethod === "top") {
      const n = parseInt(paymentTerm, 10);
      if (!Number.isFinite(n) || n <= 0) setPaymentTerm("7");
    } else {
      if (paymentTerm !== "0") setPaymentTerm("0");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [paymentMethod, paymentTerm]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const ing of ingredientList) m.set(ing.id, ing);
    return m;
  }, [ingredientList]);

  const total = useMemo(() => {
    let t = 0;
    for (const r of items) {
      const qty = parseQtyDecimal(r.qty);
      const cost = parseRupiahSafe(r.unitCost);
      if (Number.isFinite(qty) && qty > 0 && cost >= 0) {
        t += Math.round(qty * cost);
      }
    }
    return t;
  }, [items]);

  /* Sesi AE-130 — backdate detection (Anisa anti-double-count).
   * Re-classify saat user ganti tanggal belanja atau modal baru fetch
   * opname terbaru. Status di-pass ke banner di body form supaya staff
   * paham implikasi sebelum klik Simpan. */
  const backdateStatus: BackdateStatus = useMemo(
    () =>
      classifyPurchaseAgainstOpname({
        purchaseDateIso: purchaseDate,
        lastOpnameFinalizedAt: lastOpname?.finalizedAtDate ?? null,
      }),
    [purchaseDate, lastOpname],
  );
  const willSkipStockUpdate = shouldSkipStockUpdate(backdateStatus);

  function updateRow(id: string, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  /* Sesi AE-78 — Smart math handlers untuk dual-input.
   *
   * User scenario (feedback Anisa, mirror Google Sheets):
   *   "Aku mau input bawang merah 1/4 [Kg], harganya 10.000"
   * Di Sheets, dia type:
   *   - QTY (H): 0.25
   *   - Total (K): 10000
   * Harga satuan (J) auto-derive = K/H = 40000/Kg.
   *
   * Di POS pre-AE-78, dia harus type harga per Kg (40000) — terbalik dari
   * mental model dia "aku bayar 10rb untuk 250gr". AE-78 add input "Total
   * Bayar" yang bisa di-type langsung; harga per satuan jadi derived.
   *
   * Recalc logic:
   *   - inputMode="unit"  → total = qty × unitCost (re-compute on qty/cost change)
   *   - inputMode="total" → unitCost = total ÷ qty (re-compute on qty/total change) */
  function setUnitCost(id: string, newCost: string) {
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const qtyN = parseQtyDecimal(r.qty);
        const costN = parseRupiahSafe(newCost);
        const newTotal =
          Number.isFinite(qtyN) && qtyN > 0 && costN >= 0
            ? String(Math.round(qtyN * costN))
            : r.total;
        return {
          ...r,
          unitCost: newCost,
          total: newTotal,
          inputMode: "unit",
        };
      }),
    );
  }

  function setTotal(id: string, newTotal: string) {
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const qtyN = parseQtyDecimal(r.qty);
        const totalN = parseTotalSafe(newTotal);
        const newCost =
          Number.isFinite(qtyN) && qtyN > 0 && totalN >= 0
            ? String(Math.round(totalN / qtyN))
            : r.unitCost;
        return {
          ...r,
          total: newTotal,
          unitCost: newCost,
          inputMode: "total",
        };
      }),
    );
  }

  function setQty(id: string, newQty: string) {
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const qtyN = parseQtyDecimal(newQty);
        if (!Number.isFinite(qtyN) || qtyN <= 0) {
          return { ...r, qty: newQty };
        }
        if (r.inputMode === "total" && r.total) {
          const totalN = parseTotalSafe(r.total);
          const newCost = totalN >= 0 ? String(Math.round(totalN / qtyN)) : r.unitCost;
          return { ...r, qty: newQty, unitCost: newCost };
        }
        // default mode "unit" — recompute total kalau cost ada
        const costN = parseRupiahSafe(r.unitCost);
        if (costN >= 0) {
          return {
            ...r,
            qty: newQty,
            total: String(Math.round(qtyN * costN)),
          };
        }
        return { ...r, qty: newQty };
      }),
    );
  }

  /* Sesi AE-63 phase6 — staff gudang request: "input timbangan 250gr +
   * harga per kg" pattern (kayak Sheets). Saat user ganti dropdown unit,
   * kalau unit baru beda dimensi (Kg↔gr, L↔ml), auto-scale harga supaya
   * tetap match harga per unit baru.
   *
   * Contoh: Rp 10.000 dengan unit "Kg" → ganti ke "gr" → auto jadi Rp 10
   * (per gr, equivalent dgn 10rb/Kg). User boleh override kalau salah.
   *
   * Catatan: hanya scale untuk same-dimension (mass/volume/count). Discrete
   * units (Btl, Pack, Pcs) tidak di-scale karena tidak ada conversion factor.
   * convertQty returns null kalau dimensi beda atau unit unknown. */
  function onUnitChange(rowId: string, newUnit: string) {
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        /* Sesi AE-78 — kalau row di mode "total", harga per satuan adalah
         * derived dari total/qty. Total tidak perlu di-scale (ngga ada
         * unit dimension untuk total). Cuma re-derive harga supaya
         * tampilannya match unit baru.
         *
         * Kalau row di mode "unit" (default), scale harga sama unit
         * (existing AE-63 phase6 behavior). */
        if (r.inputMode === "total") {
          const qtyN = parseQtyDecimal(r.qty);
          const totalN = parseTotalSafe(r.total);
          const newCost =
            Number.isFinite(qtyN) && qtyN > 0 && totalN >= 0
              ? String(Math.round(totalN / qtyN))
              : r.unitCost;
          return { ...r, unit: newUnit, unitCost: newCost };
        }
        const scaledRaw = scaleCostOnUnitChange({
          oldUnit: r.unit,
          newUnit,
          oldCost: parseRupiahSafe(r.unitCost),
        });
        if (scaledRaw === null) {
          return { ...r, unit: newUnit };
        }
        const newCost = String(Math.round(scaledRaw));
        const qtyN = parseQtyDecimal(r.qty);
        const newTotal =
          Number.isFinite(qtyN) && qtyN > 0
            ? String(Math.round(qtyN * scaledRaw))
            : r.total;
        return {
          ...r,
          unit: newUnit,
          unitCost: newCost,
          total: newTotal,
        };
      }),
    );
  }

  function addRow() {
    setItems((prev) => [...prev, newRow()]);
  }

  function removeRow(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  function onIngredientPick(rowId: string, ingredientId: string | null) {
    if (!ingredientId) {
      updateRow(rowId, { ingredientId: "", unit: "" });
      return;
    }
    const ing = ingredientById.get(ingredientId);
    if (!ing) return;
    const row = items.find((r) => r.id === rowId);
    const patch: Partial<ItemRow> = { ingredientId };

    /* Sesi AE-130 — multi-unit tier (Anisa feedback). Kalau ingredient
     * punya unit_belanja yang di-set, prefer itu sebagai default untuk
     * Catat Pembelian — sesuai concept "belanja per L, simpan per ml".
     * Cost juga di-scale supaya angka yang muncul = Rp per belanja-unit
     * (mis. Rp 12000 per L), bukan Rp per COGS-unit (Rp 12 per ml).
     *
     * Kalau belanja tier disabled (NULL), fallback ke COGS unit + cost
     * apa adanya (perilaku lama). Server tetap source-of-truth: dia
     * convert qty + cost ke COGS unit saat write. */
    const belanjaUnit = ing.unitBelanja?.trim() || null;
    const belanjaPerCogs = ing.unitBelanjaPerCogs
      ? parseFloat(ing.unitBelanjaPerCogs)
      : null;
    const defaultUnit = belanjaUnit || ing.unit;
    const costScale =
      belanjaUnit && belanjaPerCogs && belanjaPerCogs > 0
        ? belanjaPerCogs
        : 1;
    const defaultCost = Math.round(ing.costPerUnit * costScale);

    // Auto-fill unit cost from master kalau row kosong.
    if (row && row.unitCost.trim() === "" && defaultCost > 0) {
      patch.unitCost = String(defaultCost);
      /* Sesi AE-78 — sync total kalau qty sudah ada (mirror existing math). */
      const qtyN = row ? parseQtyDecimal(row.qty) : NaN;
      if (Number.isFinite(qtyN) && qtyN > 0) {
        patch.total = String(Math.round(qtyN * defaultCost));
      }
    }
    // Auto-fill unit dari master kalau staff belum pilih.
    if (row && !row.unit) {
      patch.unit = defaultUnit;
    }
    updateRow(rowId, patch);
    // Sesi AE-21 — kalau supplier sudah dipilih, lookup market list price
    // → override unit cost + unit kalau ada match. Lebih akurat dari
    // ingredient.cost_per_unit (yang aggregate global).
    if (supplierId) {
      void lookupMarketPriceForRow(rowId, supplierId, ingredientId);
    }
  }

  async function lookupMarketPriceForRow(
    rowId: string,
    supId: string,
    ingId: string,
  ) {
    const res = await lookupMarketPriceForPurchase({
      supplierId: supId,
      ingredientId: ingId,
    });
    if (!isOk(res) || !res.data) return;
    const m = res.data;
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        /* Sesi AE-78 — sync total kalau qty ada (mirror smart math). */
        const qtyN = parseQtyDecimal(r.qty);
        const newTotal =
          Number.isFinite(qtyN) && qtyN > 0
            ? String(Math.round(qtyN * m.unitCost))
            : r.total;
        return {
          ...r,
          // Pakai harga total per pack langsung — staff input qty
          // dalam pack unit, total = qty × unit_cost.
          unitCost: String(m.unitCost),
          unit: m.packUnit,
          total: newTotal,
          inputMode: "unit",
        };
      }),
    );
    // Sesi AE-43 — simpan pack info untuk preview conversion. Server akan
    // re-lookup di transaction (source of truth tetap supplier_ingredients).
    setPackByIngredient((prev) => {
      const next = new Map(prev);
      next.set(ingId, { packSize: m.packSize, packUnit: m.packUnit });
      return next;
    });
  }

  // Sesi AE-21 — re-lookup all rows saat supplier diganti (auto-fill ulang).
  function onSupplierChange(nextSupplierId: string | null) {
    setSupplierId(nextSupplierId);
    if (!nextSupplierId) return;
    for (const r of items) {
      if (r.ingredientId) {
        void lookupMarketPriceForRow(r.id, nextSupplierId, r.ingredientId);
      }
    }
  }

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    /* Sesi AE-164 — owner feedback: klik Simpan Belanja tanpa isi → sistem
     * diam. Inline error tenggelam di bawah form panjang (di atas footer
     * sticky). Pakai toast (selalu terlihat) + tetap set inline untuk a11y. */
    const fail = (msg: string) => {
      setError(msg);
      toast.error(msg);
    };

    // Validate items.
    const validItems: Array<{
      ingredientId: string;
      qty: number;
      unitCost: number;
      unit: string | null;
    }> = [];
    for (const r of items) {
      if (!r.ingredientId && r.qty.trim() === "" && r.unitCost.trim() === "") {
        continue; // empty row, skip
      }
      if (!r.ingredientId) {
        fail("Setiap baris pembelian wajib pilih bahan");
        return;
      }
      const qty = parseQtyDecimal(r.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        fail(`Qty tidak valid untuk salah satu bahan`);
        return;
      }
      const cost = parseRupiahSafe(r.unitCost);
      if (cost < 0) {
        fail("Harga tidak boleh negatif");
        return;
      }
      const ing = ingredientById.get(r.ingredientId);
      const masterUnit = ing?.unit ?? "";
      const chosenUnit = r.unit?.trim() || masterUnit;
      // Hanya simpan unit override kalau beda dari master — kalau sama,
      // simpan NULL supaya display fallback ke unitSnapshot historis.
      const unitOverride =
        chosenUnit && chosenUnit !== masterUnit ? chosenUnit : null;
      validItems.push({
        ingredientId: r.ingredientId,
        qty,
        unitCost: cost,
        unit: unitOverride,
      });
    }
    if (validItems.length === 0) {
      fail("Minimal isi 1 baris pembelian");
      return;
    }
    const ids = validItems.map((i) => i.ingredientId);
    if (new Set(ids).size !== ids.length) {
      fail("Bahan duplikat dalam 1 purchase — gabungkan jadi 1 baris");
      return;
    }

    /* Sesi AE-43 — validasi konversi unit di client sebelum hit server.
     * Server tetap re-validate (single source of truth), tapi feedback
     * di client lebih instan dan staff bisa koreksi tanpa round-trip. */
    for (const item of validItems) {
      const ing = ingredientById.get(item.ingredientId);
      if (!ing) continue;
      const conv = convertPurchaseQty({
        qty: item.qty,
        fromUnit: item.unit ?? ing.unit,
        masterUnit: ing.unit,
        pack: packByIngredient.get(item.ingredientId) ?? null,
        ingredientPacks:
          (ing.packConversions ??
            null) as IngredientPackConversion[] | null,
      });
      if (!conv.ok) {
        fail(`Bahan "${ing.name}": ${conv.message}`);
        return;
      }
    }

    const term = parseInt(paymentTerm, 10);
    if (paymentMethod === "top" && (!Number.isFinite(term) || term <= 0)) {
      fail("TOP wajib > 0 hari");
      return;
    }

    if (directMode && paymentMethod === "top") {
      fail(
        "Pembelian langsung tidak bisa pakai TOP — pilih Cash atau Transfer.",
      );
      return;
    }
    const place = directPlace.trim();
    const composedNotes = directMode
      ? [
          `[Direct]${place ? ` @ ${place}` : ""}`,
          notes.trim(),
        ]
          .filter(Boolean)
          .join(" — ")
      : notes.trim();

    setSubmitting(true);
    const res = await createPurchase({
      supplierId: directMode ? null : supplierId,
      purchaseDate,
      paymentMethod,
      paymentTermDays: paymentMethod === "top" ? term : 0,
      invoiceNo: invoiceNo.trim() || null,
      notes: composedNotes || null,
      receiptImageUrls: receipts.length > 0 ? receipts.map((r) => r.url) : null,
      updateCost,
      createKasEntry: createKas,
      items: validItems,
    });
    setSubmitting(false);

    if (!isOk(res)) {
      fail(res.error.message);
      return;
    }

    /* Sesi AE-129 — submit sukses, hapus draft autosave supaya next open
     * mulai dari blank state (bukan banner restore data yang sudah saved). */
    clearDraft();

    /* Sesi AE-130 — feedback eksplisit untuk backdated purchase. Server
     * sudah klasifikasi + skip stock update; UI cuma narasikan supaya
     * staff aware. Untuk normal additive, toast as usual. */
    if (res.data.skippedStockUpdate) {
      toast.success(
        `Pembelian dicatat (${res.data.movementsCreated} bahan, ${formatRupiah(res.data.totalAmount)}). Stock tidak ditambah — sudah ter-cover di opname terakhir.`,
      );
    } else {
      toast.success(
        `Purchase tercatat — ${res.data.movementsCreated} bahan, total ${formatRupiah(res.data.totalAmount)}`,
      );
    }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat Pembelian"
      description="Catat semua belanja bahan / supply hari ini. Kalau cash, langsung masuk laporan kas. Untuk belanja sekali ke warung / Alfamart / pasar, toggle ke 'Pembelian langsung'."
      size="full"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan Belanja
          </Button>
        </>
      }
    >
      {loadingMaster ? (
        <p className="text-sm text-neutral-500">Memuat data…</p>
      ) : (
        <div className="space-y-4">
          {/* Sesi AE-129 — banner draft autosave restore. Muncul kalau ada
              draft di localStorage yang belum di-submit (mis. modal ke-close
              accidental, refresh tab, atau staff keluar buat tambah item ke
              Market List dulu — Anisa feedback). User pilih restore atau
              buang. Banner self-dismiss setelah salah satu di-tap. */}
          {pendingDraft ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info-300 bg-info-50 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-info-700">
                  Ada draft pembelian sebelumnya
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-700">
                  Tersimpan{" "}
                  {new Date(pendingDraft.savedAt).toLocaleString("id-ID", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {draftSummary(pendingDraft)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discardDraft}
                  aria-label="Buang draft pembelian"
                >
                  Buang
                </Button>
                <Button
                  size="sm"
                  onClick={() => applyDraft(pendingDraft)}
                  aria-label="Restore draft pembelian"
                >
                  Lanjutkan
                </Button>
              </div>
            </div>
          ) : null}

          {/* Sesi AE-130 — anti-double-count banner (Anisa feedback).
              Muncul saat tanggal belanja <= tanggal opname terakhir yang
              finalized. Stock fisik di opname sudah include belanja
              tersebut, jadi tambah lagi = double-count. Server akan SKIP
              update stock untuk pembelian ini; entry tetap masuk laporan
              keuangan + COGS reporting. */}
          {willSkipStockUpdate && lastOpname ? (
            <div className="rounded-md border border-warning-500/50 bg-warning-100/40 px-3 py-2.5 text-sm">
              <p className="font-semibold text-warning-500">
                ⚠️ Tanggal belanja {backdateStatus === "same" ? "sama dengan" : "sebelum"} opname terakhir
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-800">
                Opname terakhir di-finalize{" "}
                <strong>
                  {jakartaDateIso(lastOpname.finalizedAtDate)} (
                  {lastOpname.periodLabel})
                </strong>
                . Stock fisik saat itu sudah mencakup belanja ini, jadi
                kami <strong>tidak akan menambah stock lagi</strong>{" "}
                supaya tidak double-count. Entry tetap tersimpan untuk
                laporan kas + COGS.
              </p>
              <p className="mt-1 text-[11px] text-neutral-600">
                Kalau memang belanja ini SETELAH opname, ubah tanggal di
                atas ke{" "}
                <strong>
                  &gt; {jakartaDateIso(lastOpname.finalizedAtDate)}
                </strong>
                .
              </p>
            </div>
          ) : null}

          <div
            role="radiogroup"
            aria-label="Tipe pembelian"
            className="flex flex-wrap gap-2"
          >
            {[
              {
                value: false,
                label: "Supplier reguler",
                hint: "Pilih dari daftar supplier",
              },
              {
                value: true,
                label: "Pembelian langsung",
                hint: "Warung / Alfamart / pasar — tanpa supplier",
              },
            ].map((opt) => {
              const active = directMode === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setDirectMode(opt.value);
                    if (opt.value) {
                      setSupplierId(null);
                      // Direct buys are always pay-now; force off TOP.
                      if (paymentMethod === "top") setPaymentMethod("cash");
                    } else {
                      setDirectPlace("");
                    }
                  }}
                  className={cn(
                    "flex flex-1 min-w-[180px] flex-col items-start rounded-md border px-3 py-2 text-left text-sm transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                    active
                      ? "border-mahakan-green-700 bg-mahakan-green-100/40 text-mahakan-green-900"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-[11px] text-neutral-500">
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <DatePicker
              label="Tanggal Pembelian"
              value={purchaseDate}
              onChange={(v) => setPurchaseDate(v ?? todayJakartaIso())}
              clearable={false}
            />
            {directMode ? (
              <Input
                label="Tempat belanja (opsional)"
                placeholder="mis. Warung Bu Tini, Alfamart Cijantung"
                value={directPlace}
                onChange={(e) => setDirectPlace(e.target.value.slice(0, 80))}
                hint="Disimpan di catatan untuk audit. Kalau Owner sering belanja di sini, tambahkan jadi supplier reguler nanti."
              />
            ) : (
              <Combobox
                label="Supplier"
                placeholder="Pilih supplier"
                searchPlaceholder="Cari supplier…"
                clearable
                groups={[
                  {
                    label: "",
                    options: supplierList.map((s) => ({
                      value: s.id,
                      label: s.name,
                      hint:
                        s.defaultPaymentTermDays > 0
                          ? `TOP ${s.defaultPaymentTermDays}h`
                          : "Cash",
                      keywords: [s.category ?? ""],
                    })),
                  } satisfies ComboboxGroup,
                ]}
                value={supplierId}
                onChange={(v) => onSupplierChange(v)}
              />
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Select
              label="Metode Pembayaran"
              options={PAYMENT_OPTIONS.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            />
            <Input
              label="TOP (hari)"
              type="text"
              inputMode="numeric"
              value={paymentTerm}
              onChange={(e) => setPaymentTerm(e.target.value)}
              disabled={paymentMethod !== "top"}
              hint={
                paymentMethod === "top"
                  ? "Berapa hari setelah purchase_date jatuh tempo"
                  : "Hanya aktif untuk TOP"
              }
            />
            <Input
              label="No. Invoice (opsional)"
              placeholder="mis. INV-2026-0042"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Daftar Belanja
              </h3>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-4" aria-hidden /> Tambah Bahan
              </Button>
            </div>
            <p className="text-xs text-neutral-600">
              <strong>Mirror Google Sheet</strong> — pilih bahan, isi
              <strong> QTY</strong> (boleh 0.5 / 0.25 kalau setengah / seperempat),
              pilih satuan, lalu pilih salah satu:
              <strong className="text-mahakan-green-900">
                {" "}
                isi <em>Harga per satuan</em>
              </strong>{" "}
              <em>ATAU</em>
              <strong className="text-mahakan-green-900">
                {" "}
                isi <em>Total Bayar</em>
              </strong>
              . Field yang lain auto-hitung. Contoh: beli bawang merah 250gr,
              total Rp 10.000 → tinggal isi QTY=0.25, Satuan=Kg, Total=10.000
              → harga per Kg otomatis muncul (Rp 40.000/Kg).
            </p>
            <div className="space-y-3 rounded-md border border-neutral-200 p-2">
              {/* Sesi AE-78 — column header (sub-grid, hanya tampil di md+). */}
              <div className="hidden gap-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 md:grid md:grid-cols-[minmax(280px,2.2fr)_90px_120px_180px_180px_44px]">
                <span>Bahan</span>
                <span>QTY</span>
                <span>Satuan</span>
                <span>Harga / Satuan</span>
                <span>Total Bayar</span>
                <span />
              </div>
              {items.map((row, idx) => {
                const ing = row.ingredientId
                  ? ingredientById.get(row.ingredientId)
                  : null;
                const qtyN = parseQtyDecimal(row.qty);
                const costN = parseRupiahSafe(row.unitCost);
                const hasQty = Number.isFinite(qtyN) && qtyN > 0;
                const lineTotal =
                  hasQty && costN >= 0 ? Math.round(qtyN * costN) : 0;
                const unit = row.unit || ing?.unit || "";
                const ingredientPacks =
                  (ing?.packConversions ??
                    null) as IngredientPackConversion[] | null;
                const unitOptions = buildUnitOptions(ing?.unit, ingredientPacks);
                /* Sesi AE-43 — preview konversi qty → master unit. Hanya
                 * compute kalau ada ingredient + qty valid + unit beda
                 * dari master. Server akan re-validate, tapi UI feedback
                 * langsung supaya staff bisa koreksi sebelum submit. */
                const conv =
                  ing && hasQty
                    ? convertPurchaseQty({
                        qty: qtyN,
                        fromUnit: unit || ing.unit,
                        masterUnit: ing.unit,
                        pack: packByIngredient.get(ing.id) ?? null,
                        ingredientPacks,
                      })
                    : null;
                const masterLabel = ing
                  ? resolveUnit(ing.unit)?.label ?? ing.unit
                  : "";
                const unitChanged =
                  ing && unit && unit !== ing.unit && unit !== masterLabel;
                /* Sesi AE-63 phase6 — equivalent harga per master unit
                 * untuk transparency. Mis. user input Rp 10/gr → tampil
                 * "≈ Rp 10.000 per Kg". Helps owner verify mental math. */
                const equivCostPerMaster =
                  ing && unitChanged && costN > 0
                    ? (() => {
                        const factor = convertQty(1, masterLabel, unit);
                        if (factor === null || factor <= 0) return null;
                        return Math.round(costN * factor);
                      })()
                    : null;
                /* Sesi AE-63 phase6 — sanity check warning untuk price-per-unit
                 * yang terlalu tinggi. Threshold konservatif:
                 *  - gr/ml: > Rp 1.000 (= Rp 1jt/Kg/L — sangat mahal)
                 *  - Pcs: > Rp 1jt (kemungkinan typo, mis. lupa /1000)
                 * Tidak hard-block, cuma soft warning. */
                const suspiciousPrice = (() => {
                  if (!ing || costN <= 0) return null;
                  const u = unit.toLowerCase();
                  if ((u === "gr" || u === "g") && costN > 1000) {
                    return `Rp ${costN.toLocaleString("id-ID")}/gr setara Rp ${(costN * 1000).toLocaleString("id-ID")}/Kg — cek lagi?`;
                  }
                  if (u === "ml" && costN > 1000) {
                    return `Rp ${costN.toLocaleString("id-ID")}/ml setara Rp ${(costN * 1000).toLocaleString("id-ID")}/L — cek lagi?`;
                  }
                  return null;
                })();
                return (
                  <div
                    key={row.id}
                    className="rounded-md bg-neutral-50 p-2"
                  >
                    {/* Sesi AE-78 — Layout 6-col: Bahan / QTY / Satuan /
                     * Harga per Satuan / Total Bayar / Hapus. Plus visual
                     * indikator field mana yang user-typed vs derived. */}
                    <div className="grid gap-2 md:grid-cols-[minmax(280px,2.2fr)_90px_120px_180px_180px_44px]">
                      <Combobox
                        ariaLabel={`Bahan ${idx + 1}`}
                        placeholder="Pilih bahan…"
                        searchPlaceholder="Cari bahan…"
                        clearable={false}
                        groups={[
                          {
                            label: "",
                            options: ingredientList.map((i) => ({
                              value: i.id,
                              label: i.name,
                              hint: i.unit,
                              keywords: [i.section ?? "", i.unit],
                            })),
                          } satisfies ComboboxGroup,
                        ]}
                        value={row.ingredientId || null}
                        onChange={(v) => onIngredientPick(row.id, v)}
                      />
                      <Input
                        aria-label={`QTY baris ${idx + 1}`}
                        placeholder="QTY"
                        type="text"
                        inputMode="decimal"
                        value={row.qty}
                        onChange={(e) => setQty(row.id, e.target.value)}
                      />
                      <Select
                        ariaLabel={`Satuan baris ${idx + 1}`}
                        options={unitOptions}
                        value={unit}
                        onValueChange={(v) => onUnitChange(row.id, v)}
                        disabled={!ing}
                      />
                      {/* Harga per satuan — user-typed kalau inputMode='unit',
                       * derived (light bg) kalau inputMode='total'. */}
                      <div className="relative">
                        <Input
                          aria-label={`Harga per ${unit || "unit"} baris ${idx + 1}`}
                          placeholder={
                            row.inputMode === "total" ? "auto" : "0"
                          }
                          type="text"
                          inputMode="numeric"
                          value={row.unitCost}
                          onChange={(e) => setUnitCost(row.id, e.target.value)}
                          className={cn(
                            "pr-16",
                            row.inputMode === "total" &&
                              "bg-neutral-100 text-neutral-600",
                          )}
                        />
                        <span
                          className={cn(
                            "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            row.inputMode === "total"
                              ? "bg-neutral-200 text-neutral-500"
                              : unit
                                ? "bg-mahakan-green-100 text-mahakan-green-900"
                                : "bg-neutral-200 text-neutral-500",
                          )}
                          aria-hidden
                        >
                          {row.inputMode === "total" ? "auto" : `per ${unit || "—"}`}
                        </span>
                      </div>
                      {/* Sesi AE-78 — Total Bayar field (Sheets-style).
                       * User-typed kalau inputMode='total', derived (light bg)
                       * kalau inputMode='unit'. */}
                      <div className="relative">
                        <Input
                          aria-label={`Total bayar baris ${idx + 1}`}
                          placeholder={
                            row.inputMode === "unit" ? "auto" : "0"
                          }
                          type="text"
                          inputMode="numeric"
                          value={row.total}
                          onChange={(e) => setTotal(row.id, e.target.value)}
                          className={cn(
                            "pr-16",
                            row.inputMode === "unit" &&
                              "bg-neutral-100 text-neutral-600",
                          )}
                        />
                        <span
                          className={cn(
                            "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            row.inputMode === "unit"
                              ? "bg-neutral-200 text-neutral-500"
                              : "bg-mahakan-green-100 text-mahakan-green-900",
                          )}
                          aria-hidden
                        >
                          {row.inputMode === "unit" ? "auto" : "total"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRow(row.id)}
                        aria-label="Hapus baris"
                        title="Hapus baris"
                        className="text-danger-500 hover:bg-danger-100"
                        disabled={items.length <= 1}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {hasQty && costN > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 pr-12 text-xs text-neutral-700">
                        <span className="font-mono">
                          {formatQtyForDisplay(qtyN)} {unit || "unit"} ×{" "}
                          {formatRupiah(costN)} ={" "}
                          <strong className="text-mahakan-green-900">
                            {formatRupiah(lineTotal)}
                          </strong>
                        </span>
                        {/* Sesi AE-78 — kalau mode total, tunjukkan formula
                         * "Total ÷ QTY = Harga" supaya jelas. */}
                        {row.inputMode === "total" ? (
                          <span className="font-mono text-[11px] text-neutral-500">
                            ({formatRupiah(parseTotalSafe(row.total))} ÷{" "}
                            {formatQtyForDisplay(qtyN)} = {formatRupiah(costN)}/
                            {unit || "unit"})
                          </span>
                        ) : null}
                        {/* Sesi AE-63 phase6 — show per-master equivalent
                          * supaya owner bisa cross-check harga vs ingatannya
                          * ("harga bawang Rp 10rb/Kg"). */}
                        {equivCostPerMaster !== null ? (
                          <span className="font-mono text-[11px] text-neutral-500">
                            ≈ {formatRupiah(equivCostPerMaster)}/{masterLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : ing ? (
                      <div className="mt-1.5 flex justify-end pr-12 text-xs text-neutral-500">
                        <span>Isi QTY + (Harga ATAU Total) buat lihat hitungan</span>
                      </div>
                    ) : null}
                    {/* Sesi AE-43 — preview konversi unit ke master. Hijau
                     * = OK auto-convert; kuning = butuh Market List setup;
                     * merah = unit ga compatible, harus ganti unit. */}
                    {conv && unitChanged ? (
                      conv.ok ? (
                        <div className="mt-1 rounded-md bg-mahakan-green-100/60 px-2 py-1 text-[11px] text-mahakan-green-900">
                          ≈ {formatQtyForDisplay(conv.qtyMaster)}{" "}
                          {masterLabel}{" "}
                          {conv.mode === "via-pack" ? (
                            <span className="text-mahakan-green-900/70">
                              ({conv.explain})
                            </span>
                          ) : null}
                        </div>
                      ) : conv.error === "PACK_UNKNOWN" ? (
                        <div className="mt-1 rounded-md bg-warning-100 px-2 py-1 text-[11px] text-warning-500">
                          ⚠ {conv.message}
                        </div>
                      ) : (
                        <div className="mt-1 rounded-md bg-danger-100 px-2 py-1 text-[11px] text-danger-500">
                          ⛔ {conv.message}
                        </div>
                      )
                    ) : null}
                    {/* Sesi AE-63 phase6 — sanity warning kalau price-per-unit
                      * sangat tinggi (kemungkinan staff lupa scale). */}
                    {suspiciousPrice ? (
                      <div className="mt-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                        ⚠ {suspiciousPrice}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={updateCost}
                onChange={(e) => setUpdateCost(e.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              <span className="flex-1">
                <strong>Update harga master bahan</strong>
                <span className="ml-1 text-xs text-neutral-500">
                  — centang kalau harga belanja ini bakal jadi acuan baru.
                  Hilangkan kalau cuma deal sekali / promo.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={createKas}
                onChange={(e) => setCreateKas(e.target.checked)}
                disabled={paymentMethod === "top"}
                className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              <span className="flex-1">
                <strong>Catat otomatis di kas hari ini</strong>
                {paymentMethod === "top" ? (
                  <span className="ml-1 text-xs text-neutral-500">
                    — TOP nanti masuk kas pas tandai lunas.
                  </span>
                ) : (
                  <span className="ml-1 text-xs text-neutral-500">
                    — hilangkan kalau belum dibayar / mau catat manual nanti.
                  </span>
                )}
              </span>
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Catatan (opsional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="mis. retur next batch, ada barang patah"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
            />
          </div>

          {/* Receipt / bukti transfer upload (sesi AA #2 + AE-129 multi-nota).
              Allows JPG/PNG/WebP (foto nota) + PDF (bank/aggregator e-receipt).
              Stored di Google Drive, file di-rename otomatis dengan timestamp +
              nama original. Sesi AE-129 — Anisa feedback: belanja dari beberapa
              toko dalam satu run, jadi support multi-upload (max 5). */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label className="block text-sm font-medium text-neutral-900">
                Bukti Pembelian / Transfer (opsional)
              </label>
              {receipts.length > 0 ? (
                <span className="text-xs text-neutral-500">
                  {receipts.length} / {MAX_RECEIPTS} nota
                </span>
              ) : null}
            </div>

            {/* List existing receipts. Each row: link + filename + delete X. */}
            {receipts.length > 0 ? (
              <ul className="space-y-1.5">
                {receipts.map((r, idx) => (
                  <li
                    key={`${r.url}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2"
                  >
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center gap-2 text-xs text-mahakan-green-900 hover:underline min-w-0"
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">{r.name}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setReceipts((prev) =>
                          prev.filter((_, i) => i !== idx),
                        );
                      }}
                      disabled={submitting || uploading}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                      aria-label={`Hapus nota ${idx + 1} dari form (file tetap di Drive)`}
                      title="Hapus dari form. File yang sudah di Drive tidak ikut terhapus — hapus manual via Drive kalau perlu."
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Add-button + helper. Hidden ketika sudah capai cap. */}
            {receipts.length < MAX_RECEIPTS ? (
              <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setError(null);
                    try {
                      if (file.size > 5 * 1024 * 1024) {
                        throw new Error("Ukuran maks 5 MB");
                      }
                      // Upload to Google Drive via /api/v1/purchase-receipts/upload.
                      // Server handles auth + auto-creates year/month folders
                      // matching Owner's NOTA MAHAKAN structure (sesi AA #2 Opsi B).
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("purchaseDate", purchaseDate);
                      const res = await fetch(
                        "/api/v1/purchase-receipts/upload",
                        { method: "POST", body: fd },
                      );
                      const json = (await res.json()) as
                        | { success: true; data: { url: string; folderPath: string } }
                        | {
                            success: false;
                            error: { code: string; message: string };
                          };
                      if (!json.success) {
                        throw new Error(json.error.message);
                      }
                      // Sesi AE-129 — append ke list (multi-nota). Defensive
                      // cap di sini juga supaya kalau race condition (user
                      // double-tap saat ada di list 4), tetap di-clamp.
                      setReceipts((prev) =>
                        prev.length >= MAX_RECEIPTS
                          ? prev
                          : [
                              ...prev,
                              { url: json.data.url, name: file.name },
                            ],
                      );
                      toast.success(
                        `Bukti tersimpan di Drive · ${json.data.folderPath}`,
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Upload gagal",
                      );
                    } finally {
                      setUploading(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || submitting}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Uploading…
                    </>
                  ) : receipts.length > 0 ? (
                    <>
                      <Plus className="size-4" /> Tambah Nota Lain
                    </>
                  ) : (
                    <>
                      <ImagePlus className="size-4" /> Upload Foto / PDF
                    </>
                  )}
                </Button>
                <p className="mt-1 text-xs text-neutral-500">
                  JPG / PNG / WebP / PDF, max 5 MB per file. Bisa upload
                  sampai <strong>{MAX_RECEIPTS} nota</strong> (mis. belanja
                  dari beberapa toko). Tersimpan otomatis di Google Drive
                  Anda — folder <strong>NOTA MAHAKAN</strong> → tahun →
                  bulan, sesuai struktur lama.
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-info-200 bg-info-50 p-2 text-xs text-info-700">
                Sudah {MAX_RECEIPTS} nota — hapus salah satu kalau mau
                ganti.
              </p>
            )}
          </div>

          <div className="rounded-md bg-mahakan-green-100/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-mahakan-green-900">
                Total Pembelian
              </span>
              <span className="font-mono text-lg font-bold text-mahakan-green-900">
                {formatRupiah(total)}
              </span>
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function parseRupiahSafe(s: string): number {
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}
