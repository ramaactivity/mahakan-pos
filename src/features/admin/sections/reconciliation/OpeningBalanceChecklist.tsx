"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Info,
  Banknote,
  Briefcase,
  Building2,
  Loader2,
  Package,
  PiggyBank,
  Truck,
} from "lucide-react";
import { Card, CardContent, DatePicker, toast } from "@/components/ui";
import {
  getOwnOutlet,
  isOk,
  updateOpeningBalance,
  type Outlet,
} from "@/features/outlets";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62 — Opening balance checklist 7-step.
 * Sesi AE-70 — State persisted ke outlets.settings.openingBalance JSONB
 * (tidak lagi localStorage), supaya progress tidak hilang antar device.
 * Plus hint step 3 & 7 di-update untuk match AE-69 bank account selector.
 */

interface ChecklistState {
  trialStartDate: string;
  steps: Record<string, "done" | "skip" | "pending">;
}

const DEFAULT_STATE: ChecklistState = {
  trialStartDate: "",
  steps: {},
};

interface StepDef {
  key: string;
  title: string;
  description: string;
  Icon: typeof Package;
  /** Lokasi menu yang owner perlu kunjungi. */
  menuLabel: string;
  /** Hint step yang accurate dengan modul current (sesi AE-69+). */
  hint: string;
  /** Optional sub-bullets untuk multi-step instruction. */
  steps?: string[];
}

const STEPS: StepDef[] = [
  {
    key: "trial_date",
    title: "1. Tentukan Tanggal Mulai Trial",
    description:
      "Pilih tanggal kapan POS ini mulai efektif dipakai harian. Semua opening balance di bawah merefleksikan posisi per tanggal ini.",
    Icon: Info,
    menuLabel: "Form di kanan",
    hint: "Isi field tanggal di samping. Tanggal ini di-simpan di setting outlet, dipakai untuk badge histori vs live di laporan.",
  },
  {
    key: "stock_opname",
    title: "2. Opname Stok Bahan (Stok Awal)",
    description:
      "Jalankan stock opname HARI INI untuk semua bahan utama. Hasil opname = stok awal trial. Sistem akan track pergerakan ke depan dari titik ini.",
    Icon: Package,
    menuLabel: "Inventory → Stok Opname",
    hint: "Buka tab Inventory di sidebar, masuk ke Stok Opname, klik 'Buat Opname Baru'. Hitung fisik semua bahan utama, input qty, simpan.",
  },
  {
    key: "opening_cash",
    title: "3. Saldo Kas Drawer Awal",
    description:
      "Saat buka shift pertama, isi field 'Saldo Kas Awal' dengan jumlah uang fisik di laci kasir. Ini jadi baseline rekonsiliasi.",
    Icon: PiggyBank,
    menuLabel: "POS → Buka Shift",
    hint:
      "Di shift pertama, kasir input openingCash sesuai uang fisik di laci. " +
      "KALAU sudah buka shift dengan angka salah, koreksi via Kas → tab Pengeluaran (kalau drawer terlalu banyak, tarik) atau tab Pemasukan (kalau drawer kurang, tambah) dengan kategori 'Penyesuaian Saldo Awal' (sudah pre-seeded sistem).",
  },
  {
    key: "outstanding_kasbon",
    title: "4. Kasbon Karyawan Outstanding",
    description:
      "Input semua kasbon karyawan yang belum lunas (status: pending). Saat payroll bulan depan dihitung, sistem otomatis kurangi dari gaji.",
    Icon: Briefcase,
    menuLabel: "HR Operations → Kasbon",
    hint: "Untuk tiap kasbon outstanding: nama karyawan, jumlah Rp, tanggal asli kasbon, alasan. Buat row dengan status 'pending'.",
  },
  {
    key: "outstanding_top",
    title: "5. Utang Supplier (TOP) Outstanding",
    description:
      "Catat pembelian yang masih TOP / belum lunas. Pakai paymentType=TOP + paymentStatus=pending + tanggal asli pembelian (boleh backdated).",
    Icon: Truck,
    menuLabel: "Inventory → Pembelian",
    hint: "Buka Pembelian → Catat Pembelian. Set tanggal pembelian asli, pilih supplier, isi items dan harga, set 'TOP / Bayar Nanti'. Total jadi utang.",
  },
  {
    key: "fixed_assets",
    title: "6. Aktiva Tetap (Mesin, Equipment)",
    description:
      "Import semua aktiva tetap (mesin espresso, grinder, kulkas, dll) via CSV bulk. Dipakai untuk depresiasi otomatis bulanan.",
    Icon: Building2,
    menuLabel: "Akuntansi → Aktiva Tetap",
    hint: "Pakai CSV bulk import. Format: nama, tanggal beli, harga beli, kategori, masa pakai (bulan). Sistem auto-hitung depresiasi.",
  },
  {
    key: "bank_balance",
    title: "7. Saldo Rekening Bank Awal",
    description:
      "Catat saldo bank per tanggal trial start untuk SETIAP rekening yang dipakai (BCA Anisa ...2515, BCA Owner, BRI, dll).",
    Icon: Banknote,
    menuLabel: "Kas → Pemasukan",
    hint:
      "PASTIKAN dulu master rekening sudah ke-set di Pengaturan → Rekening Bank. " +
      "Lalu buka Kas → tab Pemasukan → Tambah. Tanggal = tanggal trial start. Nominal = saldo bank awal. " +
      "Pilih metode 'Transfer BCA' atau 'Bank Lain-lain' (per bank). Setelah pilih metode, muncul dropdown 'Rekening Bank' — pilih rekening specific. " +
      "Sistem otomatis post JE Dr <Bank rekening> / Cr 4201 Pendapatan Lain-lain. Saldo akun langsung naik di Buku Besar.",
    steps: [
      "1. Pengaturan → Rekening Bank: pastikan semua rekening tercatat",
      "2. Kas → Pemasukan → '+ Tambah Pemasukan'",
      "3. Tanggal = trial start, Deskripsi 'Penyesuaian Saldo Awal Bank [nama]'",
      "4. Nominal = saldo bank awal",
      "5. Klik metode (Transfer BCA / Bank Lain-lain) sesuai jenis bank",
      "6. Pilih rekening specific dari dropdown 'Rekening Bank'",
      "7. Simpan. Saldo akun di Buku Besar langsung bertambah.",
      "Ulangi untuk setiap rekening bank yang ada.",
    ],
  },
];

export function OpeningBalanceChecklist() {
  const [state, setState] = useState<ChecklistState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load from server on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (isOk(res)) {
        const ob = (res.data as Outlet).settings?.openingBalance;
        setState({
          trialStartDate: ob?.trialStartDate ?? "",
          steps: ob?.steps ?? {},
        });
      } else {
        setError(res.error.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced save to server when state changes
  const saveToServer = useCallback(async (next: ChecklistState) => {
    setSaving(true);
    setError(null);
    const res = await updateOpeningBalance({
      trialStartDate: next.trialStartDate || undefined,
      steps: next.steps,
    });
    setSaving(false);
    if (!isOk(res)) {
      setError(res.error.message);
      toast.error("Gagal simpan progress: " + res.error.message);
    }
  }, []);

  function setStepStatus(key: string, status: "done" | "skip" | "pending") {
    setState((s) => {
      const next = { ...s, steps: { ...s.steps, [key]: status } };
      void saveToServer(next);
      return next;
    });
  }
  function setTrialDate(date: string) {
    setState((s) => {
      const next = { ...s, trialStartDate: date };
      void saveToServer(next);
      return next;
    });
  }

  const totalSteps = STEPS.length;
  const doneCount = STEPS.filter((s) => state.steps[s.key] === "done").length;
  const skipCount = STEPS.filter((s) => state.steps[s.key] === "skip").length;
  const progressCount = doneCount + skipCount;
  const pct =
    totalSteps > 0 ? Math.round((progressCount / totalSteps) * 100) : 0;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat
        progress checklist…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* Progress + intro card */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-mahakan-green-900">
                Checklist Saldo Awal — {doneCount} selesai
                {skipCount > 0 ? ` · ${skipCount} dilewati` : ""} ·{" "}
                {totalSteps - progressCount} tersisa
              </h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Ikuti urutan dari atas ke bawah. Setelah selesai semua, sistem
                ready untuk import histori bulan-bulan lampau.{" "}
                {saving ? (
                  <span className="inline-flex items-center gap-1 text-mahakan-green-700">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    Saving…
                  </span>
                ) : null}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-3xl font-bold text-mahakan-green-700">
                {pct}%
              </div>
              <div className="text-xs text-neutral-500">progress</div>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full bg-mahakan-green-700 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          {error ? (
            <p className="rounded-md border border-danger-300 bg-danger-50 px-3 py-2 text-xs text-danger-700">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const status = state.steps[step.key] ?? "pending";
          const isFirst = idx === 0;
          const prevStatus =
            idx > 0 ? state.steps[STEPS[idx - 1].key] ?? "pending" : "done";
          const prevComplete = prevStatus === "done" || prevStatus === "skip";
          const Icon = step.Icon;
          return (
            <Card
              key={step.key}
              className={cn(
                status === "done" && "border-success-500/40 bg-success-50/30",
                status === "skip" && "border-neutral-200 bg-neutral-50/50",
                !prevComplete &&
                  status === "pending" &&
                  "opacity-70",
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                      status === "done"
                        ? "bg-success-100 text-success-700"
                        : status === "skip"
                          ? "bg-neutral-100 text-neutral-500"
                          : "bg-mahakan-green-100 text-mahakan-green-700",
                    )}
                  >
                    {status === "done" ? (
                      <CheckCircle2 className="size-5" aria-hidden />
                    ) : (
                      <Icon className="size-5" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900">
                          {step.title}
                        </h3>
                        <p className="mt-0.5 text-sm text-neutral-600">
                          {step.description}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          status === "done" &&
                            "bg-success-100 text-success-700",
                          status === "skip" &&
                            "bg-neutral-100 text-neutral-600",
                          status === "pending" &&
                            "bg-warning-100 text-warning-700",
                        )}
                      >
                        {status === "done"
                          ? "Selesai"
                          : status === "skip"
                            ? "Dilewati"
                            : "Belum"}
                      </span>
                    </div>

                    {!prevComplete && status === "pending" ? (
                      <p className="mt-2 rounded-md border border-warning-300 bg-warning-50 px-2 py-1 text-[11px] text-warning-700">
                        ⚠ Selesaikan dulu step sebelumnya supaya datanya
                        konsisten.
                      </p>
                    ) : null}

                    {isFirst ? (
                      <div className="mt-3 max-w-xs">
                        <DatePicker
                          value={state.trialStartDate || null}
                          onChange={(v) => setTrialDate(v ?? "")}
                          placeholder="Pilih tanggal trial"
                          ariaLabel="Tanggal mulai trial"
                          clearable
                        />
                        {state.trialStartDate ? (
                          <p className="mt-1 text-[11px] text-mahakan-green-700">
                            ✓ Trial start ter-set di setting outlet
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-start gap-2">
                          <ArrowRight
                            className="mt-0.5 size-4 shrink-0 text-mahakan-green-700"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-mahakan-green-900">
                              {step.menuLabel}
                            </div>
                            <div className="mt-0.5 whitespace-pre-line text-xs text-neutral-600">
                              {step.hint}
                            </div>
                            {step.steps && step.steps.length > 0 ? (
                              <ol className="mt-2 space-y-0.5 pl-3 text-xs text-neutral-700">
                                {step.steps.map((s, i) => (
                                  <li key={i} className="list-disc">
                                    {s}
                                  </li>
                                ))}
                              </ol>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setStepStatus(step.key, "done")}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                          status === "done"
                            ? "border-success-500/60 bg-success-100 text-success-700"
                            : "border-neutral-300 bg-white text-neutral-700 hover:border-success-500/60 hover:bg-success-50/40",
                        )}
                      >
                        <Check className="size-3" aria-hidden /> Tandai Selesai
                      </button>
                      <button
                        type="button"
                        onClick={() => setStepStatus(step.key, "skip")}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                          status === "skip"
                            ? "border-neutral-400 bg-neutral-200 text-neutral-700"
                            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
                        )}
                      >
                        Skip
                      </button>
                      {status !== "pending" ? (
                        <button
                          type="button"
                          onClick={() => setStepStatus(step.key, "pending")}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          <Circle className="size-3" aria-hidden /> Reset
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Footer note */}
      <Card>
        <CardContent className="p-4 text-sm text-neutral-600">
          <strong className="text-neutral-900">Setelah selesai:</strong> Lanjut
          ke tab <em>Import Histori</em> untuk upload CSV penjualan 3-6 bulan
          terakhir dari Majoo. Data ini akan otomatis muncul di Laporan
          Penjualan, P&L, dan Cash Flow dengan badge &ldquo;Histori&rdquo;.
        </CardContent>
      </Card>
    </div>
  );
}
