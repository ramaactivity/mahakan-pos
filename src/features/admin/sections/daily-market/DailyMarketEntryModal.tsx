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
import { parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-242 — satu modal untuk dua arah uang.
 *
 * Top up dan belanja dibedakan hanya oleh satu bidang (rekening asal vs
 * kategori biaya), jadi dipakai bersama alih-alih dua modal yang 90% sama
 * lalu lama-lama berbeda sendiri.
 */
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
  /* Sesi AE-243 — bahan yang dibeli, dipilih dari master supaya tidak perlu
   * mengetik dan ejaannya seragam dengan Inventory. */
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([]);
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
          ingredientIds: picked.map((p) => p.id),
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
                    : [...prev, { id, name: found.name }],
                );
              }}
              options={(ingQ.data ?? [])
                .filter((i) => !picked.some((p) => p.id === i.id))
                .map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
              placeholder="Cari bahan…"
              searchPlaceholder="Ketik nama bahan…"
              emptyText="Bahan tidak ditemukan — tulis saja di keterangan."
              loading={ingQ.isLoading}
              hint="Boleh dikosongkan. Stok TIDAK ikut bertambah dari sini — penerimaan barang tetap lewat Purchasing."
            />
            {picked.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-mahakan-green-100 py-1 pl-2.5 pr-1 text-xs font-medium text-mahakan-green-900"
                  >
                    {p.name}
                    <button
                      type="button"
                      aria-label={`Hapus ${p.name}`}
                      onClick={() =>
                        setPicked((prev) => prev.filter((x) => x.id !== p.id))
                      }
                      className="rounded-full p-0.5 hover:bg-mahakan-green-200"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
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
