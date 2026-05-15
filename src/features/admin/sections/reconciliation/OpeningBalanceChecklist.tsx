"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Info,
  Banknote,
  Briefcase,
  Building2,
  Package,
  PiggyBank,
  Truck,
} from "lucide-react";
import { Card, CardContent, DatePicker } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62 — Opening balance checklist 7-step.
 *
 * Tujuan: panduan owner setup snapshot saldo awal saat trial start. Semua
 * step reuse fitur existing (opname, kasbon, purchases TOP, dll). Checklist
 * cuma navigasi + state tracking lokal (localStorage). Tidak ada server
 * action — completion-nya manual (owner tandai sendiri).
 */

const STORAGE_KEY = "reconciliation:opening-balance:v1";

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
  /** Optional handler kalau bisa cross-navigate. Saat ini sebagian besar via
   *  text hint karena belum semua section punya programmatic entry. */
  hint: string;
}

const STEPS: StepDef[] = [
  {
    key: "trial_date",
    title: "1. Tentukan Tanggal Mulai Trial",
    description:
      "Pilih tanggal kapan POS ini mulai efektif dipakai harian. Semua opening balance di bawah merefleksikan posisi per tanggal ini.",
    Icon: Info,
    menuLabel: "Form di kanan",
    hint: "Isi field tanggal di samping. Tanggal ini cuma untuk referensi internal — tidak mengubah data.",
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
    hint: "Di shift pertama, kasir input openingCash. Kalau sudah buka shift tanpa input yang benar, koreksi via Kas → tambah/kurangi expense kategori 'Penyesuaian Saldo Awal'.",
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
      "Catat saldo bank per tanggal trial start. Pakai Income kategori 'Penyesuaian Saldo Awal' dengan tanggal lampau (-30 hari).",
    Icon: Banknote,
    menuLabel: "Kas → Pemasukan",
    hint: "Buka Kas → tab Pemasukan → Tambah. Kategori 'Penyesuaian Saldo Awal' (buat dulu kalau belum ada), tanggal mundur, amount = saldo bank.",
  },
];

export function OpeningBalanceChecklist() {
  const [state, setState] = useState<ChecklistState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChecklistState;
        /* eslint-disable react-hooks/set-state-in-effect */
        setState({ ...DEFAULT_STATE, ...parsed });
      }
    } catch {
      // ignore corrupt state
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota / private mode — skip
    }
  }, [state, hydrated]);

  function setStepStatus(key: string, status: "done" | "skip" | "pending") {
    setState((s) => ({ ...s, steps: { ...s.steps, [key]: status } }));
  }
  function setTrialDate(date: string) {
    setState((s) => ({ ...s, trialStartDate: date }));
  }

  const totalSteps = STEPS.length;
  const doneCount = STEPS.filter(
    (s) => state.steps[s.key] === "done" || state.steps[s.key] === "skip",
  ).length;
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

  return (
    <div className="space-y-4 p-6">
      {/* Progress + intro card */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-mahakan-green-900">
                Checklist Saldo Awal — {doneCount}/{totalSteps} selesai
              </h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Ikuti urutan dari atas ke bawah. Setelah selesai semua, sistem
                ready untuk import histori bulan-bulan lampau.
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
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const status = state.steps[step.key] ?? "pending";
          const isFirst = idx === 0;
          const Icon = step.Icon;
          return (
            <Card
              key={step.key}
              className={cn(
                status === "done" && "border-success-500/40 bg-success-50/30",
                status === "skip" && "border-neutral-200 bg-neutral-50/50",
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

                    {isFirst ? (
                      <div className="mt-3 max-w-xs">
                        <DatePicker
                          value={state.trialStartDate || null}
                          onChange={(v) => setTrialDate(v ?? "")}
                          placeholder="Pilih tanggal trial"
                          ariaLabel="Tanggal mulai trial"
                          clearable
                        />
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
                            <div className="mt-0.5 text-xs text-neutral-600">
                              {step.hint}
                            </div>
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
