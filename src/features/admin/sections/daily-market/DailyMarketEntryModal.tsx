"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  isOk,
  postDailyMarketSpend,
  postDailyMarketTopup,
} from "@/features/daily-market";
import { listBankAccounts } from "@/features/bank-accounts";
import { listExpenseCategories, isOk as cashIsOk } from "@/features/cash";
import { listRequestableIngredients } from "@/features/purchase-requests/actions";
import { isOk as prIsOk } from "@/features/purchase-requests/types";
import { formatRupiah } from "@/lib/format";
import {
  PurchaseReceiptsField,
  type PurchaseReceipt,
} from "@/features/admin/sections/inventory/purchases/PurchaseReceiptsField";
import { cn } from "@/lib/utils";
import {
  applyQtyChange,
  applyTotalChange,
  applyUnitChange,
  applyUnitCostChange,
  effectiveLineTotal,
  parsePurchaseQty,
  parseRupiahSafe,
  type SmartMathRow,
} from "@/features/admin/sections/inventory/purchases/purchase-line-helpers";
import { todayJakarta } from "@/lib/tz";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  displayUnit,
  resolveQtyToMaster,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";

/**
 * Sesi AE-242 — satu modal untuk dua arah uang.
 *
 * Top up dan belanja dibedakan hanya oleh satu bidang (rekening asal vs
 * kategori biaya), jadi dipakai bersama alih-alih dua modal yang 90% sama
 * lalu lama-lama berbeda sendiri.
 */
/**
 * Sesi AE-256 — satu baris bahan di nota pasar, formatnya disamakan dengan
 * Daftar Belanja di Purchasing: isi Harga per satuan ATAU Total Bayar, yang
 * lain dihitung. Semua bidang angka disimpan sebagai TEKS supaya mengetik
 * "0," atau menghapus isi tidak melompat jadi 0 di tengah ketikan, dan
 * hitungannya memakai helper yang sama persis dengan Purchasing.
 */
type MarketIngredient = {
  id: string;
  name: string;
  unit: string;
  packConversions?: Array<{ unitLabel: string; qtyPerBase: number }> | null;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
};

interface ItemRow extends SmartMathRow {
  key: string;
  ingredientId: string;
  unit: string;
}

function newRow(): ItemRow {
  return {
    key: Math.random().toString(36).slice(2),
    ingredientId: "",
    qty: "",
    unit: "",
    unitCost: "",
    total: "",
    inputMode: "unit",
  };
}

const ROW_GRID =
  "md:grid-cols-[minmax(200px,2fr)_80px_110px_150px_150px_40px]";

function MarketItemRow({
  idx,
  row,
  ing,
  ingredientOptions,
  onChange,
  onRemove,
}: {
  idx: number;
  row: ItemRow;
  ing: MarketIngredient | null;
  ingredientOptions: Array<{ value: string; label: string; hint: string }>;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}) {
  const { options: unitOptions, value: unit } = buildUnitSelectOptions({
    presets: CANONICAL_UNIT_PRESETS,
    packLabels: [
      ing?.unit ?? "",
      ing?.unitBelanja ?? "",
      ...(ing?.packConversions ?? []).map((p) => p.unitLabel),
    ],
    current: row.unit || ing?.unit || "",
  });
  const qtyN = parsePurchaseQty(row.qty);
  const lineTotal = effectiveLineTotal(row);

  /* Konversi dihitung di layar HANYA untuk diperlihatkan — server menghitung
   * ulang dengan helper yang sama sebelum menyimpan, jadi angka di sini tidak
   * pernah jadi sumber kebenaran. */
  const conv =
    ing && qtyN > 0
      ? resolveQtyToMaster({
          qty: qtyN,
          fromUnit: unit,
          masterUnit: ing.unit,
          ingredientPacks: (ing.packConversions ??
            []) as unknown as IngredientPackConversion[],
          unitBelanja: ing.unitBelanja,
          unitBelanjaPerCogs: ing.unitBelanjaPerCogs,
        })
      : null;
  const unitUnknown = conv !== null && !conv.ok;
  const smart = (r: SmartMathRow) => onChange(r);

  return (
    <div className="rounded-xl bg-neutral-50 p-2">
      <div className={cn("grid gap-2", ROW_GRID)}>
        <Combobox
          ariaLabel={`Bahan ${idx + 1}`}
          placeholder="Pilih bahan…"
          searchPlaceholder="Cari bahan…"
          emptyText="Bahan tidak ditemukan — tulis saja di keterangan."
          clearable={false}
          options={ingredientOptions}
          value={row.ingredientId || null}
          onChange={(id) => {
            if (!id) return;
            onChange({ ingredientId: id, unit: "" });
          }}
        />
        <Input
          aria-label={`QTY baris ${idx + 1}`}
          placeholder="QTY"
          inputMode="decimal"
          value={row.qty}
          onChange={(e) => smart(applyQtyChange(row, e.target.value))}
        />
        <Select
          ariaLabel={`Satuan baris ${idx + 1}`}
          value={unit}
          onValueChange={(u) =>
            onChange({ unit: u, ...applyUnitChange(row, unit, u) })
          }
          options={unitOptions}
          disabled={!ing}
        />
        <div className="relative">
          <Input
            aria-label={`Harga per ${unit || "satuan"} baris ${idx + 1}`}
            placeholder={row.inputMode === "total" ? "auto" : "0"}
            inputMode="numeric"
            value={row.unitCost}
            onChange={(e) => smart(applyUnitCostChange(row, e.target.value))}
            className={cn(
              "pr-14",
              row.inputMode === "total" && "bg-neutral-100 text-neutral-600",
            )}
          />
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
            aria-hidden
          >
            {row.inputMode === "total" ? "auto" : `per ${unit || "—"}`}
          </span>
        </div>
        <div className="relative">
          <Input
            aria-label={`Total bayar baris ${idx + 1}`}
            placeholder={row.inputMode === "unit" ? "auto" : "0"}
            inputMode="numeric"
            value={row.total}
            onChange={(e) => smart(applyTotalChange(row, e.target.value))}
            className={cn(
              "pr-14",
              row.inputMode === "unit" && "bg-neutral-100 text-neutral-600",
            )}
          />
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
            aria-hidden
          >
            {row.inputMode === "unit" ? "auto" : "total"}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label="Hapus baris"
          title="Hapus baris"
          className="text-danger-500 hover:bg-danger-100"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      {ing ? (
        <div className="mt-1.5 flex flex-wrap justify-end gap-x-3 pr-12 text-xs">
          <span className={unitUnknown ? "text-danger-500" : "text-neutral-500"}>
            {unitUnknown
              ? `Satuan "${unit}" belum dikenal untuk bahan ini`
              : conv?.ok && conv.qtyMaster !== null && unit !== ing.unit
                ? `= ${conv.qtyMaster.toLocaleString("id-ID")} ${ing.unit}`
                : lineTotal > 0
                  ? ""
                  : "Isi QTY + (Harga ATAU Total) buat lihat hitungan"}
          </span>
          {lineTotal > 0 ? (
            <span className="font-medium text-neutral-900">
              {formatRupiah(lineTotal)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* Pilihan terakhir diingat per perangkat — kurir, rekening, dan kategori
 * hampir selalu sama tiap hari. Penyimpanan bisa tidak tersedia (mode
 * privat), jadi semua akses dibungkus try/catch dan form tetap jalan. */
const PREF_KEY = "mahakan.daily-market.prefs";
type Prefs = { courierName?: string; bankAccountId?: string; categoryId?: string };
function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}
function writePrefs(patch: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* tidak apa-apa — hanya kenyamanan */
  }
}

export function DailyMarketEntryModal({
  kind,
  defaultCourier,
  onClose,
  onSaved,
}: {
  kind: "topup" | "spend" | null;
  /** Kurir dari catatan terakhir — dipakai kalau perangkat ini belum ingat. */
  defaultCourier?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isTopup = kind === "topup";
  const [amount, setAmount] = useState("");
  /* Nominal nota mengikuti total bahan sampai diketik sendiri — kebanyakan
   * nota pasar memang isinya bahan semua. */
  const [amountTouched, setAmountTouched] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(todayJakarta());
  const [bankAccountId, setBankAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  /* Sesi AE-245 — bahan yang dibeli berikut jumlah & harganya, dipilih dari
   * master supaya ejaannya seragam dengan Inventory. */
  const [rows, setRows] = useState<ItemRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    const prefs = readPrefs();
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount("");
    setAmountTouched(false);
    setDescription("");
    setRows([newRow()]);
    setReceipts([]);
    setEntryDate(todayJakarta());
    setCourierName(prefs.courierName ?? defaultCourier ?? "");
    setBankAccountId(prefs.bankAccountId ?? "");
    setCategoryId(prefs.categoryId ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    /* Sengaja hanya saat modal dibuka: daftar catatan yang ter-refresh di
     * belakang tidak boleh menimpa isian yang sedang diketik. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const banksQ = useQuery({
    queryKey: ["daily-market", "banks"],
    queryFn: async () => {
      const r = await listBankAccounts();
      return r.ok ? r.data : [];
    },
    enabled: kind === "topup",
  });
  const ingQ = useQuery({
    queryKey: ["daily-market", "ingredients"],
    queryFn: async () => {
      const r = await listRequestableIngredients();
      return prIsOk(r) ? r.data : [];
    },
    enabled: kind === "spend",
    staleTime: 5 * 60 * 1000,
  });
  const catsQ = useQuery({
    queryKey: ["daily-market", "categories"],
    queryFn: async () => {
      const r = await listExpenseCategories();
      return cashIsOk(r) ? r.data.items : [];
    },
    enabled: kind === "spend",
  });

  /* Pembagian nota: bagian yang jadi persediaan vs sisanya yang jadi beban. */
  const ingById = new Map((ingQ.data ?? []).map((i) => [i.id, i]));
  /* Baris tanpa bahan dianggap kosong dan dilewati, sama seperti Purchasing. */
  const filled = rows.filter((r) => r.ingredientId);
  const itemsTotal = filled.reduce((sum, r) => sum + effectiveLineTotal(r), 0);
  const updateRow = (key: string, patch: Partial<ItemRow>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        /* Bahan baru dipilih: satuan default = satuan belanjanya. */
        if (patch.ingredientId && patch.ingredientId !== r.ingredientId) {
          const ing = ingById.get(patch.ingredientId);
          next.unit = displayUnit(ing?.unitBelanja?.trim() || ing?.unit || "");
        }
        return next;
      }),
    );
  /* Rekening cuma satu → langsung terpilih, tidak perlu dipilih tiap kali. */
  const banks = banksQ.data ?? [];
  const effectiveBankId =
    bankAccountId && banks.some((b) => b.id === bankAccountId)
      ? bankAccountId
      : banks.length === 1
        ? banks[0]!.id
        : bankAccountId;
  const typedAmount = parseRupiahSafe(amount);
  const amountValue = !isTopup && !amountTouched ? itemsTotal : typedAmount;
  const remainder = amountValue - itemsTotal;

  async function submit() {
    if (submitting) return;
    setError(null);
    if (amountValue <= 0) {
      setError(isTopup ? "Isi nominal top up" : "Isi bahan yang dibeli atau nominal nota");
      return;
    }
    if (courierName.trim().length < 2) {
      setError("Isi nama kurir");
      return;
    }
    if (isTopup && !effectiveBankId) {
      setError("Pilih rekening asal transfer");
      return;
    }
    if (!isTopup && !categoryId) {
      setError("Pilih kategori belanja");
      return;
    }
    /* Baris bahan yang belum lengkap ditolak di sini, bukan dibiarkan lolos
     * jadi baris Rp 0 yang tidak berarti apa-apa di laporan. */
    const incomplete = filled.find(
      (r) => !(parsePurchaseQty(r.qty) > 0) || effectiveLineTotal(r) <= 0,
    );
    if (incomplete) {
      const name = ingById.get(incomplete.ingredientId)?.name ?? "bahan";
      setError(`Jumlah dan harga/total "${name}" belum diisi`);
      return;
    }
    if (!isTopup && itemsTotal > amountValue) {
      setError(
        `Nilai bahan ${formatRupiah(itemsTotal)} melebihi nominal nota ${formatRupiah(amountValue)}`,
      );
      return;
    }
    /* Keterangan belanja wajib di server; kalau dikosongkan, dirangkum dari
     * nama bahan supaya tidak ada catatan tanpa judul. */
    const spendDescription =
      description.trim() ||
      filled
        .map((r) => ingById.get(r.ingredientId)?.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ") ||
      "Belanja pasar";
    const receiptImageUrls = receipts.map((r) => r.url);
    setSubmitting(true);
    const res = isTopup
      ? await postDailyMarketTopup({
          amount: amountValue,
          bankAccountId: effectiveBankId,
          courierName: courierName.trim(),
          entryDate,
          description: description.trim() || undefined,
          receiptImageUrls,
        })
      : await postDailyMarketSpend({
          amount: amountValue,
          categoryId,
          courierName: courierName.trim(),
          description: spendDescription.slice(0, 200),
          entryDate,
          receiptImageUrls,
          items: filled.map((r) => ({
            ingredientId: r.ingredientId,
            qty: parsePurchaseQty(r.qty),
            unit: r.unit || null,
            unitCost: parseRupiahSafe(r.unitCost),
            /* AE-216 — total yang diketik yang menang. */
            subtotal: effectiveLineTotal(r),
          })),
        });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    writePrefs(
      isTopup
        ? { courierName: courierName.trim(), bankAccountId: effectiveBankId }
        : { courierName: courierName.trim(), categoryId },
    );
    toast.success(isTopup ? "Top up tercatat" : "Belanja tercatat");
    onSaved();
  }

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={isTopup ? "Top Up Saldo Kurir" : "Catat Belanja Pasar"}
      description={
        isTopup
          ? "Uang ditransfer dari rekening outlet ke kurir. Saldo rekening berkurang, saldo kurir bertambah."
          : "Belanja dibayar dari saldo kurir, bukan dari kas outlet."
      }
      size={isTopup ? "md" : "full"}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {error ? (
            <p
              role="alert"
              className="mr-auto rounded-full bg-danger-100 px-3 py-1.5 text-sm text-danger-600"
            >
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Menyimpan…"
              : amountValue > 0
                ? `Simpan ${formatRupiah(amountValue)}`
                : "Simpan"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Tanggal"
            value={entryDate}
            onChange={(v) => setEntryDate(v ?? todayJakarta())}
            maxDate={todayJakarta()}
            clearable={false}
            required
          />
          <Input
            label="Kurir"
            value={courierName}
            onChange={(e) => setCourierName(e.target.value)}
            placeholder="Nama kurir"
            required
          />
        </div>

        {isTopup ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericInput
              label="Nominal transfer"
              prefix="Rp"
              value={amount}
              onChange={setAmount}
              placeholder="0"
              required
            />
            <Select
              label="Dari rekening"
              value={effectiveBankId}
              onValueChange={setBankAccountId}
              options={banks.map((b) => ({
                value: b.id,
                label: `${b.bankName} — ${b.accountName}`,
              }))}
              placeholder="Pilih rekening asal"
            />
          </div>
        ) : (
          <section className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Bahan yang dibeli
                </h3>
                <p className="text-xs text-neutral-600">
                  Isi QTY + satuan, lalu <strong>harga per satuan</strong>{" "}
                  <em>atau</em> <strong>total bayar</strong> — yang satunya
                  dihitung otomatis.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRows((prev) => [...prev, newRow()])}
              >
                <Plus className="size-4" aria-hidden /> Tambah Bahan
              </Button>
            </div>
            {rows.length > 0 ? (
              <div className="space-y-2 rounded-2xl border border-neutral-200 p-2">
                <div
                  className={cn(
                    "hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 md:grid",
                    ROW_GRID,
                  )}
                >
                  <span>Bahan</span>
                  <span>QTY</span>
                  <span>Satuan</span>
                  <span>Harga / Satuan</span>
                  <span>Total Bayar</span>
                  <span />
                </div>
                {rows.map((r, idx) => (
                  <MarketItemRow
                    key={r.key}
                    idx={idx}
                    row={r}
                    ing={ingById.get(r.ingredientId) ?? null}
                    ingredientOptions={(ingQ.data ?? [])
                      .filter(
                        (i) =>
                          i.id === r.ingredientId ||
                          !rows.some((x) => x.ingredientId === i.id),
                      )
                      .map((i) => ({ value: i.id, label: i.name, hint: i.unit }))}
                    onChange={(patch) => updateRow(r.key, patch)}
                    onRemove={() =>
                      setRows((prev) => prev.filter((x) => x.key !== r.key))
                    }
                  />
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <NumericInput
                label="Total nota"
                prefix="Rp"
                value={amountTouched ? amount : itemsTotal > 0 ? String(itemsTotal) : ""}
                onChange={(v) => {
                  setAmountTouched(true);
                  setAmount(v);
                }}
                placeholder="0"
                hint={
                  amountTouched
                    ? "Lebih besar dari total bahan kalau ada parkir, plastik, kuli angkut."
                    : "Otomatis = total bahan. Ubah kalau ada biaya lain di nota."
                }
                required
              />
              <Select
                label="Kategori biaya"
                value={categoryId}
                onValueChange={setCategoryId}
                options={(catsQ.data ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                placeholder="Pilih kategori"
              />
            </div>

            {/* Pembagian nota diperlihatkan sebelum disimpan: angka inilah
                yang menentukan berapa yang jadi persediaan dan berapa yang
                langsung jadi beban. */}
            {filled.length > 0 || amountValue > 0 ? (
              <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-neutral-50 p-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-neutral-600">Masuk persediaan</dt>
                  <dd className="font-semibold tabular-nums text-neutral-900">
                    {formatRupiah(itemsTotal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-600">Biaya lain di nota</dt>
                  <dd
                    className={cn(
                      "font-semibold tabular-nums",
                      remainder < 0 ? "text-danger-600" : "text-neutral-900",
                    )}
                  >
                    {formatRupiah(remainder)}
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-neutral-600">Saldo kurir terpotong</dt>
                  <dd className="font-semibold tabular-nums text-danger-600">
                    − {formatRupiah(amountValue)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </section>
        )}

        <Input
          label={isTopup ? "Keterangan (opsional)" : "Keterangan (opsional)"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isTopup
              ? "Misal: saldo belanja minggu ini"
              : "Kosongkan → otomatis dari nama bahan"
          }
        />

        <PurchaseReceiptsField
          value={receipts}
          onChange={setReceipts}
          purchaseDate={entryDate}
          disabled={submitting}
          label={isTopup ? "Bukti transfer (opsional)" : "Foto nota (opsional)"}
          onError={setError}
        />
      </div>
    </Modal>
  );
}
