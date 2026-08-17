"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Save, Scale, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Skeleton,
  toast,
} from "@/components/ui";
import { formatRupiah } from "@/lib/format";
/* Server action WAJIB di-import langsung dari "./actions", bukan lewat barrel
 * "@/features/accounting" — barrel-nya cuma re-export type (jebakan
 * use-server barrel). */
import {
  fetchOpeningBalanceEditor,
  saveOpeningBalance,
  type OpeningBalanceEditorAccount,
} from "@/features/accounting/actions";

/**
 * Sesi AE-207 — UBAH SALDO AWAL.
 *
 * Owner: "saya ingin ada fitur langsung ubah nominal saldo awal, karena data
 * cut off tadi ingin disesuaikan dengan data fisik."
 *
 * Jadi layar ini bekerja dengan NILAI RIIL, bukan selisih: owner mengetik
 * "kas Rp 12.000.000" apa adanya, dan tidak pernah memikirkan debit/kredit.
 * Arah debit/kredit diambil dari `normalBalance` tiap akun, dan selisih
 * apa pun otomatis mendarat di 3301 Saldo Laba Ditahan — jadi TIDAK MUNGKIN
 * owner membuat neraca jadi tidak seimbang dari sini.
 *
 * Simpan = batalkan jurnal saldo awal lama (pair-void) lalu post yang baru,
 * mengikuti aturan sistem bahwa jurnal ter-post tidak diubah di tempat.
 * Riwayat "dulu saldo awalnya berapa" tetap terbaca di halaman Jurnal.
 */

const TYPE_GROUPS = [
  { type: "asset", label: "Aset — yang dimiliki", hint: "Kas, bank, piutang, stok, peralatan" },
  { type: "liability", label: "Kewajiban — yang dihutang", hint: "Hutang supplier, kreditur, talangan" },
  { type: "equity", label: "Modal", hint: "Setoran modal owner / investor" },
] as const;

/**
 * `input` menyimpan BESARANNYA saja (tanpa tanda) karena `NumericInput`
 * membuang karakter "−", dan `negative` menyimpan tandanya lewat tombol
 * terpisah. Perlu, bukan hiasan: saldo yang berlaku sekarang punya
 * `3101 Modal Owner` = −Rp11.700.000, jadi tanpa ini form-nya tidak bisa
 * menyimpan kembali kondisi yang sedang berjalan.
 */
type Row = OpeningBalanceEditorAccount & {
  input: string;
  negative: boolean;
};

function signedValue(r: Row): number {
  const n = Math.round(Number(r.input || 0));
  if (!Number.isFinite(n)) return 0;
  return r.negative ? -n : n;
}

export function OpeningBalanceEditor({
  defaultDate,
}: {
  /** Dipakai kalau saldo awal belum pernah di-post. */
  defaultDate?: string;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [entryDate, setEntryDate] = useState<string>("");
  const [reason, setReason] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ["admin", "accounting", "opening-balance-editor"],
    queryFn: async () => {
      const res = await fetchOpeningBalanceEditor();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const data = query.data;

  /* Isi form sekali saat data datang. Sengaja TIDAK pakai useEffect ber-key
   * ke `data`: refresh latar (TanStack) melahirkan objek baru tiap kali dan
   * ketikan owner yang belum disimpan akan terhapus — jebakan form-reset yang
   * sudah pernah menggigit di modal HPP. */
  const initKey = data ? `${data.entryId ?? "none"}` : null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (data && initKey !== seededKey) {
    setSeededKey(initKey);
    setRows(
      data.filled.map((a) => ({
        ...a,
        input: String(Math.abs(a.amount)),
        negative: a.amount < 0,
      })),
    );
    setEntryDate(data.entryDate ?? defaultDate ?? "");
  }

  const totals = useMemo(() => {
    let asset = 0;
    let liabEquity = 0;
    let hasNegative = false;
    for (const r of rows ?? []) {
      const v = signedValue(r);
      if (v < 0) hasNegative = true;
      if (r.type === "asset") {
        // Akun contra (Akum. Penyusutan) mengurangi aset.
        asset += r.normalBalance === "debit" ? v : -v;
      } else {
        liabEquity += r.normalBalance === "credit" ? v : -v;
      }
    }
    return { asset, liabEquity, plug: liabEquity - asset, hasNegative };
  }, [rows]);

  const availableToAdd = useMemo(() => {
    if (!data) return [];
    const used = new Set((rows ?? []).map((r) => r.accountId));
    return data.available.filter(
      (a) => !used.has(a.accountId) && a.code !== data.retainedCode,
    );
  }, [data, rows]);

  function setAmount(accountId: string, next: string) {
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.accountId === accountId ? { ...r, input: next } : r,
      ),
    );
  }

  function toggleSign(accountId: string) {
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.accountId === accountId ? { ...r, negative: !r.negative } : r,
      ),
    );
  }

  function addAccount(accountId: string) {
    const acc = data?.available.find((a) => a.accountId === accountId);
    if (!acc) return;
    setRows((prev) => [
      ...(prev ?? []),
      { ...acc, input: "", negative: false },
    ]);
    setAddOpen(false);
  }

  function removeAccount(accountId: string) {
    setRows((prev) => (prev ?? []).filter((r) => r.accountId !== accountId));
  }

  async function onSave() {
    if (saving || !rows) return;
    setSaving(true);
    const res = await saveOpeningBalance({
      entryDate,
      amounts: rows.map((r) => ({
        accountId: r.accountId,
        amount: signedValue(r),
      })),
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Saldo awal tersimpan (${res.data.entryNumber})${
        res.data.replacedEntryNumber
          ? ` — menggantikan ${res.data.replacedEntryNumber}`
          : ""
      }`,
    );
    setConfirmOpen(false);
    setSeededKey(null); // paksa muat ulang dari server
    // Neraca, Laba Rugi, Buku Besar semua berubah — segarkan semuanya.
    void queryClient.invalidateQueries();
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3 p-6" role="status" aria-label="Memuat saldo awal">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError || !data || !rows) {
    return (
      <p className="p-6 text-sm text-danger-700">
        Gagal memuat saldo awal
        {query.error instanceof Error ? `: ${query.error.message}` : ""}.
      </p>
    );
  }

  const dateMissing = !/^\d{4}-\d{2}-\d{2}$/.test(entryDate);

  return (
    <div className="space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" aria-hidden />
            Ubah Saldo Awal
          </CardTitle>
          <CardDescription>
            Ketik nilai <strong>riil</strong> per akun — apa adanya, bukan
            selisihnya. Tidak perlu memikirkan debit/kredit: selisihnya otomatis
            masuk Saldo Laba Ditahan, jadi neraca selalu seimbang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.entryNumber ? (
            <p className="text-xs text-neutral-600">
              Saldo awal yang berlaku:{" "}
              <strong>{data.entryNumber}</strong> tanggal{" "}
              <strong>{data.entryDate}</strong>. Menyimpan akan{" "}
              <strong>membatalkan</strong> jurnal itu dan mem-post yang baru —
              jejaknya tetap ada di halaman Jurnal.
            </p>
          ) : (
            <p className="text-xs text-neutral-600">
              Belum ada saldo awal yang ter-post. Yang Bapak simpan di sini akan
              jadi saldo awal pertama.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker
              label="Tanggal Saldo Awal"
              value={entryDate}
              onChange={(v) => setEntryDate(v ?? "")}
            />
            <Input
              label="Alasan / catatan (opsional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="contoh: disesuaikan hasil hitung kas fisik"
              maxLength={200}
            />
          </div>

          {TYPE_GROUPS.map((g) => {
            const groupRows = rows.filter((r) => r.type === g.type);
            if (groupRows.length === 0) return null;
            return (
              <div key={g.type} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-mahakan-green-900">
                    {g.label}
                  </h3>
                  <span className="text-[11px] text-neutral-500">{g.hint}</span>
                </div>
                <div className="space-y-1.5">
                  {groupRows.map((r) => (
                    <div
                      key={r.accountId}
                      className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-neutral-800">
                          <span className="font-mono text-xs text-neutral-500">
                            {r.code}
                          </span>{" "}
                          {r.name}
                        </p>
                        {r.isContra ? (
                          <p className="text-[10px] text-neutral-500">
                            Akun pengurang — nilainya mengurangi total{" "}
                            {r.type === "asset" ? "aset" : "modal"}
                          </p>
                        ) : null}
                      </div>
                      {/* Tombol tanda — NumericInput tidak menerima "−". */}
                      <button
                        type="button"
                        onClick={() => toggleSign(r.accountId)}
                        aria-label={`Ubah tanda nilai ${r.name}`}
                        aria-pressed={r.negative}
                        title={
                          r.negative
                            ? "Nilai MINUS (saldo berlawanan arah normal akun). Klik untuk jadikan positif."
                            : "Nilai positif. Klik kalau saldo akun ini memang minus."
                        }
                        className={`shrink-0 rounded-md border px-2 py-1 font-mono text-sm ${
                          r.negative
                            ? "border-warning-500 bg-warning-100/40 text-warning-500"
                            : "border-neutral-300 text-neutral-500 hover:border-neutral-400"
                        }`}
                      >
                        {r.negative ? "−" : "+"}
                      </button>
                      <div className="w-40 shrink-0">
                        <NumericInput
                          value={r.input}
                          onChange={(v) => setAmount(r.accountId, v)}
                          prefix="Rp"
                          placeholder="0"
                          ariaLabel={`Nilai ${r.code} ${r.name}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAccount(r.accountId)}
                        aria-label={`Hapus baris ${r.name}`}
                        title="Hapus baris (sama dengan nilai 0)"
                        className="shrink-0 rounded-md p-1.5 text-neutral-400 hover:bg-danger-100/40 hover:text-danger-700"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={availableToAdd.length === 0}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Tambah akun
          </Button>

          {/* Ringkasan — angka ini yang bikin owner yakin sebelum simpan. */}
          <div className="space-y-1 rounded-lg bg-neutral-50 p-3 text-sm">
            <Line label="Total Aset" value={totals.asset} />
            <Line label="Total Kewajiban + Modal" value={totals.liabEquity} />
            <div className="border-t border-neutral-200 pt-1">
              <Line
                label={`Selisih → ${data.retainedCode} Saldo Laba Ditahan`}
                value={totals.plug}
                muted
              />
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-neutral-600">
              {totals.plug > 0
                ? "Selisih positif = akumulasi KERUGIAN periode-periode lalu (kewajiban + modal lebih besar dari aset)."
                : totals.plug < 0
                  ? "Selisih negatif = akumulasi LABA periode-periode lalu (aset lebih besar dari kewajiban + modal)."
                  : "Pas — tidak ada selisih yang perlu ditampung."}
            </p>
          </div>

          {totals.hasNegative ? (
            <p className="flex items-start gap-1.5 rounded-md border border-warning-500/40 bg-warning-100/30 p-2 text-xs text-neutral-700">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-warning-500"
                aria-hidden
              />
              <span>
                Ada akun bertanda <strong>−</strong> (saldo berlawanan arah
                normalnya). Itu sah secara pembukuan, tapi jarang benar untuk
                kas/bank/stok. Pastikan memang begitu sebelum menyimpan.
              </span>
            </p>
          ) : null}

          {dateMissing ? (
            <p className="flex items-center gap-1.5 text-xs text-warning-500">
              <AlertTriangle className="size-3.5" aria-hidden />
              Isi Tanggal Saldo Awal dulu.
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={saving || dateMissing || rows.length === 0}
            >
              <Save className="mr-1.5 h-4 w-4" aria-hidden />
              Simpan Saldo Awal
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Tambah akun ke saldo awal"
      >
        <div className="space-y-3">
          <Combobox
            label="Pilih akun"
            options={availableToAdd.map((a) => ({
              value: a.accountId,
              label: `${a.code} — ${a.name}`,
              hint:
                a.type === "asset"
                  ? "Aset"
                  : a.type === "liability"
                    ? "Kewajiban"
                    : "Modal",
              keywords: [a.code, a.name],
            }))}
            value={null}
            onChange={(v) => v && addAccount(v)}
            placeholder="Cari kode atau nama akun…"
          />
          <p className="text-xs text-neutral-600">
            Hanya akun neraca (aset, kewajiban, modal). Akun pendapatan &amp;
            beban tidak punya saldo awal — saldonya selalu nol di awal periode.
          </p>
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => !saving && setConfirmOpen(false)}
        title="Simpan saldo awal?"
      >
        <div className="space-y-3 text-sm">
          <p>
            Saldo awal tanggal <strong>{entryDate}</strong> akan di-set dengan
            total <strong>{formatRupiah(Math.max(totals.asset, 0))}</strong> di
            sisi aset.
          </p>
          {data.entryNumber ? (
            <p className="rounded-md bg-warning-100/30 p-2 text-xs text-neutral-700">
              Jurnal <strong>{data.entryNumber}</strong> akan dibatalkan
              (status jadi &quot;reversed&quot;, bukan dihapus) lalu diganti
              jurnal baru. Neraca, Laba Rugi, dan Buku Besar langsung ikut
              berubah.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? "Menyimpan…" : "Ya, simpan"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={muted ? "text-neutral-600" : "text-neutral-800"}>
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${muted ? "text-neutral-700" : "font-semibold text-mahakan-green-900"}`}
      >
        {formatRupiah(value)}
      </span>
    </div>
  );
}
