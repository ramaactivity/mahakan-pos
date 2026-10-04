"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Combobox, Input, Modal, Select, toast } from "@/components/ui";
import {
  isOk,
  postDailyMarketSpend,
  postDailyMarketTopup,
} from "@/features/daily-market";
import { listBankAccounts } from "@/features/bank-accounts";
import { listExpenseCategories, isOk as cashIsOk } from "@/features/cash";
import { listRequestableIngredients } from "@/features/purchase-requests/actions";
import { isOk as prIsOk } from "@/features/purchase-requests/types";
import { formatRupiah, parseRupiah } from "@/lib/format";
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
    <div className="rounded-md bg-neutral-50 p-2">
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

export function DailyMarketEntryModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: "topup" | "spend" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isTopup = kind === "topup";
  const [amount, setAmount] = useState("");
  const [courierName, setCourierName] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(todayJakarta());
  const [bankAccountId, setBankAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  /* Sesi AE-245 — bahan yang dibeli berikut jumlah & harganya, dipilih dari
   * master supaya ejaannya seragam dengan Inventory. */
  const [rows, setRows] = useState<ItemRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount("");
    setDescription("");
    setRows([newRow()]);
    setEntryDate(todayJakarta());
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
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
  const amountValue = (() => {
    try {
      return parseRupiah(amount);
    } catch {
      return 0;
    }
  })();
  const remainder = amountValue - itemsTotal;

  async function submit() {
    if (submitting) return;
    setError(null);
    let parsed = 0;
    try {
      parsed = parseRupiah(amount);
    } catch {
      setError("Nominal tidak valid");
      return;
    }
    if (parsed <= 0) {
      setError("Nominal harus lebih dari 0");
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
    if (!isTopup && itemsTotal > parsed) {
      setError(
        `Nilai bahan ${formatRupiah(itemsTotal)} melebihi nominal nota ${formatRupiah(parsed)}`,
      );
      return;
    }
    setSubmitting(true);
    const res = isTopup
      ? await postDailyMarketTopup({
          amount: parsed,
          bankAccountId,
          courierName,
          entryDate,
          description: description.trim() || undefined,
        })
      : await postDailyMarketSpend({
          amount: parsed,
          categoryId,
          courierName,
          description: description.trim(),
          entryDate,
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
    toast.success(isTopup ? "Top up tercatat" : "Belanja tercatat");
    onSaved();
  }

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={isTopup ? "Top Up Kurir" : "Catat Belanja Daily Market"}
      description={
        isTopup
          ? "Uang keluar dari rekening dan masuk ke saldo kurir."
          : "Belanja memakai saldo kurir, bukan kas outlet."
      }
      size={isTopup ? "md" : "full"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nominal (Rp)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          autoFocus
        />
        <Input
          label="Nama kurir / driver"
          value={courierName}
          onChange={(e) => setCourierName(e.target.value)}
          placeholder="Misal: Pak Dedi"
        />
        {isTopup ? (
          <Select
            label="Transfer dari rekening"
            value={bankAccountId}
            onValueChange={setBankAccountId}
            options={(banksQ.data ?? []).map((b) => ({
              value: b.id,
              label: `${b.bankName} — ${b.accountName}`,
            }))}
            placeholder="Pilih rekening asal"
          />
        ) : (
          <Select
            label="Kategori belanja"
            value={categoryId}
            onValueChange={setCategoryId}
            options={(catsQ.data ?? []).map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            placeholder="Pilih kategori"
          />
        )}
        {!isTopup ? (
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-neutral-900">
                  Bahan yang dibeli (opsional)
                </h3>
                <p className="text-xs text-neutral-600">
                  Sama seperti Purchasing: isi QTY + satuan, lalu isi{" "}
                  <strong>Harga per satuan</strong> <em>atau</em>{" "}
                  <strong>Total Bayar</strong> — yang lain auto-hitung. Bahan
                  di sini masuk persediaan; biaya non-barang (parkir, plastik,
                  kuli angkut) cukup ditulis di keterangan.
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
              <div className="space-y-2 rounded-md border border-neutral-200 p-2">
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
            {filled.length > 0 ? (
              <div>
                {/* Pembagian nota diperlihatkan sebelum disimpan: angka inilah
                    yang menentukan berapa yang jadi persediaan dan berapa yang
                    langsung jadi beban. */}
                <div className="rounded-lg bg-neutral-50 p-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Nilai bahan (persediaan)</span>
                    <span className="font-medium">{formatRupiah(itemsTotal)}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-neutral-600">Sisa nota (beban langsung)</span>
                    <span
                      className={
                        remainder < 0 ? "font-medium text-danger-500" : "font-medium"
                      }
                    >
                      {formatRupiah(remainder)}
                    </span>
                  </div>
                  {remainder < 0 ? (
                    <p className="mt-1.5 text-danger-500">
                      Nilai bahan melebihi nominal nota. Perbaiki jumlah/harga,
                      atau naikkan nominalnya.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <Input
          label={isTopup ? "Keterangan (opsional)" : "Keterangan belanja"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isTopup ? "Misal: top up belanja minggu ini" : "Misal: sayur + ayam"
          }
        />
        <Input
          label="Tanggal"
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
        />
        {error ? (
          <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
