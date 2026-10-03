"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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
import { todayJakarta } from "@/lib/tz";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
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
 * Sesi AE-245 — satu baris bahan di nota pasar.
 *
 * `qtyText` disimpan sebagai teks, bukan angka: kalau dipaksa number, mengetik
 * "0," atau menghapus isinya akan melompat jadi 0 di tengah ketikan.
 */
interface PickedItem {
  id: string;
  name: string;
  masterUnit: string;
  packConversions: Array<{ unitLabel: string; qtyPerBase: number }>;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
  qtyText: string;
  qty: number;
  unit: string;
  unitCostText: string;
  unitCost: number;
}

function MarketItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: PickedItem;
  onChange: (next: PickedItem) => void;
  onRemove: () => void;
}) {
  const { options: unitOptions, value: unit } = buildUnitSelectOptions({
    presets: CANONICAL_UNIT_PRESETS,
    packLabels: [
      item.masterUnit,
      item.unitBelanja ?? "",
      ...item.packConversions.map((p) => p.unitLabel),
    ],
    current: item.unit || item.masterUnit,
  });

  /* Konversi dihitung di layar HANYA untuk diperlihatkan — server menghitung
   * ulang dengan helper yang sama sebelum menyimpan, jadi angka di sini tidak
   * pernah jadi sumber kebenaran. */
  const conv =
    item.qty > 0
      ? resolveQtyToMaster({
          qty: item.qty,
          fromUnit: unit,
          masterUnit: item.masterUnit,
          ingredientPacks: item
            .packConversions as unknown as IngredientPackConversion[],
          unitBelanja: item.unitBelanja,
          unitBelanjaPerCogs: item.unitBelanjaPerCogs,
        })
      : null;
  const unitUnknown = item.qty > 0 && conv !== null && !conv.ok;
  const subtotal = item.qty > 0 ? Math.round(item.qty * item.unitCost) : 0;

  return (
    <div className="rounded-lg border border-neutral-200 p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900">{item.name}</span>
        <button
          type="button"
          aria-label={`Hapus ${item.name}`}
          onClick={onRemove}
          className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto_1.2fr] gap-2">
        <Input
          label="Jumlah"
          inputMode="decimal"
          value={item.qtyText}
          onChange={(e) => {
            const text = e.target.value;
            const n = parseFloat(text.replace(",", "."));
            onChange({
              ...item,
              qtyText: text,
              qty: Number.isFinite(n) && n > 0 ? n : 0,
            });
          }}
          placeholder="0"
        />
        <Select
          label="Satuan"
          value={unit}
          onValueChange={(u) => onChange({ ...item, unit: u })}
          options={unitOptions}
        />
        <Input
          label="Harga satuan (Rp)"
          inputMode="numeric"
          value={item.unitCostText}
          onChange={(e) => {
            const text = e.target.value;
            let n = 0;
            try {
              n = parseRupiah(text);
            } catch {
              n = 0;
            }
            onChange({ ...item, unitCostText: text, unitCost: n });
          }}
          placeholder="0"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="text-neutral-500">
          {unitUnknown
            ? `Satuan "${unit}" belum dikenal untuk bahan ini`
            : conv?.ok && conv.qtyMaster !== null
              ? `= ${conv.qtyMaster.toLocaleString("id-ID")} ${item.masterUnit}`
              : ""}
        </span>
        <span className="font-medium text-neutral-900">
          {formatRupiah(subtotal)}
        </span>
      </div>
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
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount("");
    setDescription("");
    setPicked([]);
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
  const itemsTotal = picked.reduce(
    (sum, p) => sum + (p.qty > 0 ? Math.round(p.qty * p.unitCost) : 0),
    0,
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
    const incomplete = picked.find((p) => p.qty <= 0 || p.unitCost <= 0);
    if (incomplete) {
      setError(`Jumlah dan harga "${incomplete.name}" belum diisi`);
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
          items: picked.map((p) => ({
            ingredientId: p.id,
            qty: p.qty,
            unit: p.unit,
            unitCost: p.unitCost,
            subtotal: p.qty > 0 ? Math.round(p.qty * p.unitCost) : undefined,
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
      size="md"
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
          <div>
            <Combobox
              label="Bahan yang dibeli (opsional)"
              value={null}
              onChange={(id) => {
                if (!id) return;
                const found = (ingQ.data ?? []).find((i) => i.id === id);
                if (!found) return;
                setPicked((prev) =>
                  prev.some((p) => p.id === id)
                    ? prev
                    : [
                        ...prev,
                        {
                          id,
                          name: found.name,
                          masterUnit: found.unit,
                          packConversions: found.packConversions ?? [],
                          unitBelanja: found.unitBelanja,
                          unitBelanjaPerCogs: found.unitBelanjaPerCogs,
                          qtyText: "",
                          qty: 0,
                          unit: found.unit,
                          unitCostText: "",
                          unitCost: 0,
                        },
                      ],
                );
              }}
              options={(ingQ.data ?? [])
                .filter((i) => !picked.some((p) => p.id === i.id))
                .map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
              placeholder="Cari bahan…"
              searchPlaceholder="Ketik nama bahan…"
              emptyText="Bahan tidak ditemukan — tulis saja di keterangan."
              loading={ingQ.isLoading}
              hint="Bahan yang diisi di sini masuk persediaan dan menambah stok, sama seperti Purchasing. Biaya non-barang (parkir, plastik, kuli angkut) cukup ditulis di keterangan."
            />
            {picked.length > 0 ? (
              <div className="mt-2 space-y-2">
                {picked.map((p) => (
                  <MarketItemRow
                    key={p.id}
                    item={p}
                    onChange={(next) =>
                      setPicked((prev) =>
                        prev.map((x) => (x.id === next.id ? next : x)),
                      )
                    }
                    onRemove={() =>
                      setPicked((prev) => prev.filter((x) => x.id !== p.id))
                    }
                  />
                ))}
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
