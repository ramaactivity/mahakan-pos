"use client";

import { useEffect, useState } from "react";
import { Boxes, AlertCircle } from "lucide-react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  createFixedAsset,
  type CreateFixedAssetInput,
} from "@/features/accounting/fixed-assets-actions";
import { fetchAccounts } from "@/features/accounting/actions";
import { formatRupiah } from "@/lib/money";
import { todayJakarta } from "@/lib/tz";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const ASSET_ACCOUNT_OPTIONS = [
  { value: "1201|6501", label: "Furniture & Peralatan Cafe → 6501" },
  { value: "1202|6502", label: "Mesin & Peralatan Dapur → 6502" },
  { value: "1203|6503", label: "Peralatan Bar → 6503" },
  { value: "1204|6504", label: "Peralatan IT (POS, printer, tablet) → 6504" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash (1101 Kas Tunai)" },
  { value: "transfer_bca", label: "Transfer BCA (1110)" },
  { value: "transfer_bri", label: "Transfer BRI (1111)" },
  { value: "transfer_other", label: "Transfer Lain (1112)" },
];

const LIFETIME_PRESETS = [
  { value: "12", label: "12 bulan (1 tahun)" },
  { value: "24", label: "24 bulan (2 tahun)" },
  { value: "36", label: "36 bulan (3 tahun)" },
  { value: "48", label: "48 bulan (4 tahun)" },
  { value: "60", label: "60 bulan (5 tahun) — common" },
  { value: "96", label: "96 bulan (8 tahun)" },
  { value: "120", label: "120 bulan (10 tahun)" },
];

export function AssetFormModal({ open, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [cost, setCost] = useState("0");
  const [salvage, setSalvage] = useState("0");
  const [usefulLife, setUsefulLife] = useState("60");
  const [acquiredDate, setAcquiredDate] = useState<string | null>(
    todayJakarta(),
  );
  const [accountPair, setAccountPair] = useState("1202|6502");
  const [capitalize, setCapitalize] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("transfer_bca");
  /* Sesi AE-212 — akun lawan bebas. Kosong = pakai pemetaan bawaan dari
   * "Bayar dari". Diisi = owner memilih sendiri akun yang dikredit, mis.
   * Hutang Dagang untuk aset yang dibeli tempo, atau Hutang Internal untuk
   * aset yang ditalangi pengelola. */
  const [creditAccountCode, setCreditAccountCode] = useState("");
  const [accounts, setAccounts] = useState<
    Array<{ code: string; name: string; type: string }>
  >([]);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Sesi AE-212 — daftar akun untuk memilih lawan jurnalnya sendiri. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAccounts().then((res) => {
      if (cancelled || !res.ok) return;
      setAccounts(
        res.data
          .filter((a) => a.isActive)
          .map((a) => ({ code: a.code, name: a.name, type: a.type })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName("");
    setCategory("");
    setCost("0");
    setSalvage("0");
    setUsefulLife("60");
    setAcquiredDate(todayJakarta());
    setAccountPair("1202|6502");
    setCapitalize(true);
    setPaymentMethod("transfer_bca");
    setCreditAccountCode("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const costNum = Number(cost) || 0;
  /* Sesi AE-212 — label akun untuk pratinjau debit/kredit. */
  const previewAssetCode = accountPair.split("|")[0] ?? "";
  const previewDepCode = accountPair.split("|")[1] ?? "";
  const accountLabel = (code: string, fallback: string) => {
    const hit = accounts.find((a) => a.code === code);
    return hit ? `${hit.code} · ${hit.name}` : fallback;
  };
  const debitAccountLabel = accountLabel(
    previewAssetCode,
    `${previewAssetCode} · Aset Tetap`,
  );
  const depreciationLabel = accountLabel(
    previewDepCode,
    `${previewDepCode} Beban Penyusutan`,
  );
  const fallbackCreditCode =
    paymentMethod === "cash"
      ? "1101"
      : paymentMethod === "transfer_bca"
        ? "1110"
        : paymentMethod === "transfer_bri"
          ? "1111"
          : "1112";
  const effectiveCreditCode = creditAccountCode || fallbackCreditCode;
  const creditAccountLabel = accountLabel(
    effectiveCreditCode,
    `${effectiveCreditCode} · Kas/Bank`,
  );
  const salvageNum = Number(salvage) || 0;
  const lifeNum = Number(usefulLife) || 0;
  const monthlyDep =
    lifeNum > 0 && costNum > salvageNum
      ? Math.floor((costNum - salvageNum) / lifeNum)
      : 0;

  async function onSubmit() {
    if (submitting) return;
    setError(null);

    if (name.trim().length < 2) {
      setError("Nama aset minimal 2 karakter");
      return;
    }
    if (costNum <= 0) {
      setError("Biaya pengadaan harus > 0");
      return;
    }
    if (salvageNum >= costNum) {
      setError("Nilai sisa harus < cost");
      return;
    }
    if (lifeNum < 1 || lifeNum > 600) {
      setError("Useful life harus 1-600 bulan");
      return;
    }
    if (!acquiredDate) {
      setError("Tanggal pengadaan wajib diisi");
      return;
    }

    const [assetCode, depCode] = accountPair.split("|");

    setSubmitting(true);
    const input: CreateFixedAssetInput = {
      name: name.trim(),
      category: category.trim() || null,
      cost: costNum,
      salvageValue: salvageNum,
      usefulLifeMonths: lifeNum,
      acquiredDate,
      assetAccountCode: assetCode,
      depreciationAccountCode: depCode,
      capitalize,
      paymentMethod: capitalize
        ? (paymentMethod as
            | "cash"
            | "transfer_bca"
            | "transfer_bri"
            | "transfer_other")
        : undefined,
      creditAccountCode: capitalize && creditAccountCode ? creditAccountCode : null,
      notes: notes.trim() || null,
    };
    const res = await createFixedAsset(input);
    setSubmitting(false);
    if (res.ok) {
      if (res.data.capitalizeError) {
        /* Asetnya tersimpan tapi jurnalnya gagal — jangan bilang "berhasil"
         * begitu saja, nanti dikira sudah masuk neraca. */
        toast.error(
          `Aset tersimpan, TAPI jurnalnya gagal: ${res.data.capitalizeError}. Buat jurnalnya manual di Akuntansi → Jurnal.`,
        );
      } else {
        toast.success(
          capitalize
            ? "Aset disimpan + jurnal pengadaan terposting"
            : "Aset disimpan (tanpa jurnal)",
        );
      }
      onSaved();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Aset Tetap"
      description="Aset di-depreciate straight-line per bulan. Capitalize = posting journal Dr Asset Cr Kas/Bank otomatis."
      size="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">
            {monthlyDep > 0 ? (
              <>
                Monthly depreciation: <strong>{formatRupiah(monthlyDep)}</strong>{" "}
                × {lifeNum} bulan
              </>
            ) : (
              "Isi cost + useful life"
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={onSubmit} loading={submitting}>
              <Boxes className="size-4" /> Simpan
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nama Aset"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mesin Espresso La Marzocco Linea Mini"
          required
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Kategori (opsional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Peralatan Bar"
          />
          <DatePicker
            label="Tanggal Pengadaan"
            value={acquiredDate}
            onChange={setAcquiredDate}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumericInput
            label="Cost (biaya pengadaan)"
            value={cost}
            onChange={setCost}
            prefix="Rp"
          />
          <NumericInput
            label="Nilai Sisa (salvage)"
            value={salvage}
            onChange={setSalvage}
            prefix="Rp"
            hint="Default 0 — nilai jual asumsi setelah useful life habis"
          />
        </div>

        <Select
          label="Useful Life (bulan)"
          options={LIFETIME_PRESETS}
          value={usefulLife}
          onValueChange={setUsefulLife}
        />

        <Select
          label="Pasangan Akun (Aset → Beban Penyusutan)"
          options={ASSET_ACCOUNT_OPTIONS}
          value={accountPair}
          onValueChange={setAccountPair}
          hint="Akumulasi penyusutan otomatis ke 1290 (kontra-asset)"
        />

        <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={capitalize}
              onChange={(e) => setCapitalize(e.target.checked)}
              className="mt-0.5 size-4 rounded border-neutral-300"
            />
            <div>
              <div className="font-medium text-neutral-900">
                Capitalize sekarang (posting jurnal Dr Asset Cr Kas/Bank)
              </div>
              <div className="text-xs text-neutral-600">
                Default ON. Uncheck kalau asset sudah ada di neraca via opening
                balance / manual entry sebelumnya — register saja tanpa double
                journal.
              </div>
            </div>
          </label>
          {capitalize ? (
            <div className="mt-3 space-y-3">
              <Select
                label="Bayar dari"
                options={PAYMENT_METHOD_OPTIONS}
                value={paymentMethod}
                onValueChange={(v) => {
                  setPaymentMethod(v);
                  /* Pilih metode bawaan = lepaskan akun lawan manual. */
                  setCreditAccountCode("");
                }}
                disabled={creditAccountCode !== ""}
              />
              {/* Sesi AE-212 — akun lawan bebas. Empat metode bawaan hanya
                  menutup kas + tiga bank; aset yang dibeli tempo atau
                  ditalangi pengelola tidak punya jalannya, dan jurnalnya
                  terlanjur mengkredit bank yang uangnya tidak keluar. */}
              <Select
                label="Atau pilih sendiri akun lawannya (opsional)"
                options={[
                  { value: "", label: "— pakai pilihan “Bayar dari” di atas —" },
                  ...accounts.map((a) => ({
                    value: a.code,
                    label: `${a.code} · ${a.name}`,
                  })),
                ]}
                value={creditAccountCode}
                onValueChange={setCreditAccountCode}
              />

              {/* Pratinjau jurnal — owner melihat debit & kreditnya sebelum
                  menyimpan, bukan menebak apa yang dilakukan sistem. */}
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Jurnal yang akan terbentuk
                </p>
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="text-left font-medium">Akun</th>
                      <th className="w-28 text-right font-medium">Debit</th>
                      <th className="w-28 text-right font-medium">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1">{debitAccountLabel}</td>
                      <td className="py-1 text-right font-medium">
                        {formatRupiah(costNum > 0 ? costNum : 0)}
                      </td>
                      <td className="py-1 text-right text-neutral-400">—</td>
                    </tr>
                    <tr>
                      <td className="py-1">{creditAccountLabel}</td>
                      <td className="py-1 text-right text-neutral-400">—</td>
                      <td className="py-1 text-right font-medium">
                        {formatRupiah(costNum > 0 ? costNum : 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
                  Penyusutan bulanannya dijurnal terpisah tiap akhir bulan:
                  Debit {depreciationLabel}, Kredit 1290 Akumulasi Penyusutan.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">
            Catatan (opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700"
            placeholder="Serial number, supplier, warranty, dll."
          />
        </div>

        {error ? (
          <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-500">
            <AlertCircle className="mr-2 inline size-4" />
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
