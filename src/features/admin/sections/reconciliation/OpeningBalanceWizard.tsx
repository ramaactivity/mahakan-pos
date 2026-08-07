"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Package,
  PiggyBank,
  Plus,
  Sparkles,
  Trash2,
  Truck,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  DatePicker,
  Input,
  Select,
  toast,
} from "@/components/ui";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import { createIncome } from "@/features/cash";
import { createEmployeeAdvance } from "@/features/employee-advances/actions";
import { listEmployees } from "@/features/employees/actions";
import type { Employee } from "@/features/employees/types";
import {
  getOpeningBalanceAutoStatus,
  getOwnOutlet,
  isOk,
  updateOpeningBalance,
  type OpeningBalanceAutoStatus,
  type Outlet,
} from "@/features/outlets";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-75 — Wizard rewrite of OpeningBalanceChecklist.
 *
 * Why: owner Rama bilang checklist scroll-through bikin overwhelming.
 * Wizard pattern (1 step visible at a time, step indicator at top) lebih
 * focused — owner fokus 1 task dulu, lalu lanjut. Plus 3 step pakai
 * inline quick-add form supaya tidak perlu switch ke modul lain.
 *
 * Step structure:
 * 1. Tanggal Trial          — inline DatePicker
 * 2. Stock Opname           — deep-link only (multi-row complexity)
 * 3. Saldo Kas Drawer       — deep-link only (shift open flow)
 * 4. Kasbon Outstanding     — inline quick-add multi-row
 * 5. Utang Supplier TOP     — deep-link only (multi-line items)
 * 6. Aktiva Tetap           — deep-link only (CSV preferred)
 * 7. Saldo Bank Awal        — inline quick-add multi-row
 * 8. Selesai                — summary + CTA Import Histori
 */

type StepStatus = "done" | "skip" | "pending";

interface ChecklistState {
  trialStartDate: string;
  steps: Record<string, StepStatus>;
}

const DEFAULT_STATE: ChecklistState = {
  trialStartDate: "",
  steps: {},
};

type WizardStepKind = "deeplink" | "inline_kasbon" | "inline_bank" | "trial_date";

interface WizardStep {
  key: string;
  n: number;
  title: string;
  description: string;
  Icon: typeof Package;
  menuLabel: string;
  hint: string;
  steps?: string[];
  kind: WizardStepKind;
  targetSection?: string;
  autoDetectCount?: (s: OpeningBalanceAutoStatus) => number;
}

const STEPS: WizardStep[] = [
  {
    key: "trial_date",
    n: 1,
    title: "Tanggal Mulai Trial",
    description:
      "Pilih tanggal kapan POS ini mulai efektif dipakai harian. Semua opening balance di bawah merefleksikan posisi per tanggal ini.",
    Icon: Info,
    menuLabel: "Form di bawah",
    hint: "Pilih tanggal di field. Disimpan di setting outlet, dipakai untuk badge histori vs live di laporan.",
    kind: "trial_date",
  },
  {
    key: "stock_opname",
    n: 2,
    title: "Opname Stok Bahan",
    description:
      "Jalankan stock opname HARI INI untuk semua bahan utama. Hasil opname = stok awal trial. Sistem akan track pergerakan ke depan dari titik ini.",
    Icon: Package,
    menuLabel: "Inventory → Stok Opname",
    hint: "Buka tab Inventory di sidebar, masuk ke Stok Opname, klik 'Buat Opname Baru'. Hitung fisik semua bahan utama, input qty, simpan.",
    kind: "deeplink",
    targetSection: "inventory",
    autoDetectCount: (s) => s.stockOpnameCount,
  },
  {
    key: "opening_cash",
    n: 3,
    title: "Saldo Kas Drawer Awal",
    description:
      "Saat buka shift pertama, isi field 'Saldo Kas Awal' dengan jumlah uang fisik di laci kasir. Ini jadi baseline rekonsiliasi.",
    Icon: PiggyBank,
    menuLabel: "POS → Buka Shift",
    hint:
      "Di shift pertama, kasir input openingCash sesuai uang fisik di laci. " +
      "KALAU sudah buka shift dengan angka salah, koreksi via Kas → tab Pengeluaran / Pemasukan dengan kategori 'Penyesuaian Saldo Awal'.",
    kind: "deeplink",
    targetSection: "shifts",
    autoDetectCount: (s) => s.shiftWithOpeningCashCount,
  },
  {
    key: "outstanding_kasbon",
    n: 4,
    title: "Kasbon Karyawan Outstanding",
    description:
      "Input semua kasbon karyawan yang belum lunas (status: pending). Saat payroll bulan depan dihitung, sistem otomatis kurangi dari gaji.",
    Icon: Briefcase,
    menuLabel: "Form inline di bawah",
    hint: "Pilih karyawan dari dropdown, isi nominal kasbon, tanggal asli kasbon, klik Tambah. Boleh banyak entry sekaligus.",
    kind: "inline_kasbon",
    targetSection: "hr-operations",
    autoDetectCount: (s) => s.outstandingKasbonCount,
  },
  {
    key: "outstanding_top",
    n: 5,
    title: "Utang Supplier (TOP) Outstanding",
    description:
      "Catat pembelian yang masih TOP / belum lunas. Pakai paymentType=TOP + paymentStatus=pending + tanggal asli pembelian (boleh backdated).",
    Icon: Truck,
    menuLabel: "Inventory → Pembelian",
    hint: "Buka Pembelian → Catat Pembelian. Set tanggal pembelian asli, pilih supplier, isi items dan harga, set 'TOP / Bayar Nanti'. Total jadi utang.",
    kind: "deeplink",
    targetSection: "purchases",
    autoDetectCount: (s) => s.outstandingTopPurchaseCount,
  },
  {
    key: "fixed_assets",
    n: 6,
    title: "Aktiva Tetap (Mesin, Equipment)",
    description:
      "Import semua aktiva tetap (mesin espresso, grinder, kulkas, dll) via CSV bulk. Dipakai untuk depresiasi otomatis bulanan.",
    Icon: Building2,
    menuLabel: "Akuntansi → Aktiva Tetap",
    hint: "Pakai CSV bulk import. Format: nama, tanggal beli, harga beli, kategori, masa pakai (bulan). Sistem auto-hitung depresiasi.",
    kind: "deeplink",
    targetSection: "accounting",
    autoDetectCount: (s) => s.fixedAssetsCount,
  },
  {
    key: "bank_balance",
    n: 7,
    title: "Saldo Rekening Bank Awal",
    description:
      "Catat saldo bank per tanggal trial start untuk SETIAP rekening yang dipakai (BCA, BRI, BNI, dll). Sistem otomatis post jurnal Dr Bank / Cr 4201 Pendapatan Lain-lain.",
    Icon: Banknote,
    menuLabel: "Form inline di bawah",
    hint:
      "PASTIKAN dulu master rekening sudah ke-set di Pengaturan → Rekening Bank. " +
      "Lalu pilih rekening dari dropdown, isi nominal saldo awal, klik Tambah.",
    kind: "inline_bank",
    targetSection: "cash",
    autoDetectCount: (s) => s.saldoAwalIncomeCount,
  },
];

const DONE_STEP_N = STEPS.length + 1; // 8

export function OpeningBalanceWizard() {
  const [state, setState] = useState<ChecklistState>(DEFAULT_STATE);
  const [autoStatus, setAutoStatus] =
    useState<OpeningBalanceAutoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentN, setCurrentN] = useState<number>(1);

  // Load outlet state + auto-detect counts on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [outletRes, autoRes] = await Promise.all([
        getOwnOutlet(),
        getOpeningBalanceAutoStatus(),
      ]);
      if (cancelled) return;
      if (isOk(outletRes)) {
        const ob = (outletRes.data as Outlet).settings?.openingBalance;
        setState({
          trialStartDate: ob?.trialStartDate ?? "",
          steps: ob?.steps ?? {},
        });
      } else {
        setError(outletRes.error.message);
      }
      if (isOk(autoRes)) {
        setAutoStatus(autoRes.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAutoStatus = useCallback(async () => {
    const res = await getOpeningBalanceAutoStatus();
    if (isOk(res)) setAutoStatus(res.data);
  }, []);

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

  function setStepStatus(key: string, status: StepStatus) {
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

  const doneCount = STEPS.filter((s) => state.steps[s.key] === "done").length;
  const skipCount = STEPS.filter((s) => state.steps[s.key] === "skip").length;
  const progressCount = doneCount + skipCount;
  const pct =
    STEPS.length > 0 ? Math.round((progressCount / STEPS.length) * 100) : 0;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat
        progress wizard…
      </div>
    );
  }

  const isDoneScreen = currentN >= DONE_STEP_N;
  const currentStep = STEPS.find((s) => s.n === currentN);

  function goPrev() {
    setCurrentN((n) => Math.max(1, n - 1));
  }
  function goNext() {
    setCurrentN((n) => Math.min(DONE_STEP_N, n + 1));
  }

  return (
    <div className="space-y-4 p-6">
      <StepIndicator
        currentN={currentN}
        steps={state.steps}
        onJump={(n) => setCurrentN(n)}
      />

      {/* Progress bar */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-neutral-600">
              Progress wizard: <strong>{doneCount}</strong> selesai
              {skipCount > 0 ? `, ${skipCount} dilewati` : ""},{" "}
              {STEPS.length - progressCount} tersisa
              {saving ? (
                <span className="ml-2 inline-flex items-center gap-1 text-mahakan-green-700">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Saving…
                </span>
              ) : null}
            </div>
            <div className="text-lg font-bold text-mahakan-green-700">
              {pct}%
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
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

      {/* Current step content */}
      {isDoneScreen ? (
        <DoneScreen
          autoStatus={autoStatus}
          steps={state.steps}
          onBack={() => setCurrentN(STEPS.length)}
          onRestart={() => setCurrentN(1)}
        />
      ) : currentStep ? (
        <StepCard
          step={currentStep}
          status={state.steps[currentStep.key] ?? "pending"}
          trialStartDate={state.trialStartDate}
          autoStatus={autoStatus}
          onTrialDate={setTrialDate}
          onMarkStatus={(s) => setStepStatus(currentStep.key, s)}
          onRefreshAuto={refreshAutoStatus}
        />
      ) : null}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="ghost"
          onClick={goPrev}
          disabled={currentN === 1}
        >
          <ArrowLeft className="size-4" aria-hidden /> Kembali
        </Button>
        {isDoneScreen ? null : (
          <Button onClick={goNext}>
            {currentN === STEPS.length ? "Lihat Ringkasan" : "Lanjut"}{" "}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Step Indicator ----------------------------- */

function StepIndicator({
  currentN,
  steps,
  onJump,
}: {
  currentN: number;
  steps: Record<string, StepStatus>;
  onJump: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((s) => {
        const active = currentN === s.n;
        const status = steps[s.key] ?? "pending";
        const Icon = s.Icon;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onJump(s.n)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-mahakan-green-700 text-white"
                : status === "done"
                  ? "bg-success-100 text-success-700"
                  : status === "skip"
                    ? "bg-neutral-200 text-neutral-600"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
            )}
          >
            <Icon className="size-3" aria-hidden />
            <span>{s.n}</span>
            <span className="hidden sm:inline">{s.title.split("(")[0].trim()}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onJump(DONE_STEP_N)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
          currentN >= DONE_STEP_N
            ? "bg-mahakan-green-700 text-white"
            : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
        )}
      >
        <CheckCircle2 className="size-3" aria-hidden />
        <span>{DONE_STEP_N}</span>
        <span className="hidden sm:inline">Selesai</span>
      </button>
    </div>
  );
}

/* ------------------------------- Step Card -------------------------------- */

function StepCard({
  step,
  status,
  trialStartDate,
  autoStatus,
  onTrialDate,
  onMarkStatus,
  onRefreshAuto,
}: {
  step: WizardStep;
  status: StepStatus;
  trialStartDate: string;
  autoStatus: OpeningBalanceAutoStatus | null;
  onTrialDate: (date: string) => void;
  onMarkStatus: (s: StepStatus) => void;
  onRefreshAuto: () => Promise<void>;
}) {
  const Icon = step.Icon;
  const detectedCount =
    autoStatus && step.autoDetectCount ? step.autoDetectCount(autoStatus) : null;
  const hasDetected = detectedCount != null && detectedCount > 0;

  return (
    <Card
      className={cn(
        status === "done" && "border-success-500/40",
        status === "skip" && "border-neutral-300",
      )}
    >
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
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
                <div className="text-xs font-semibold text-neutral-500">
                  Step {step.n} dari {STEPS.length}
                </div>
                <h2 className="mt-0.5 text-lg font-bold text-mahakan-green-900">
                  {step.title}
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  {step.description}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  status === "done" && "bg-success-100 text-success-700",
                  status === "skip" && "bg-neutral-100 text-neutral-600",
                  status === "pending" && "bg-warning-100 text-warning-700",
                )}
              >
                {status === "done"
                  ? "Selesai"
                  : status === "skip"
                    ? "Dilewati"
                    : "Belum"}
              </span>
            </div>

            {detectedCount != null ? (
              <p
                className={cn(
                  "mt-3 rounded-md border px-2.5 py-1.5 text-xs",
                  hasDetected
                    ? "border-success-300 bg-success-50 text-success-700"
                    : "border-neutral-200 bg-neutral-50 text-neutral-500",
                )}
              >
                {hasDetected
                  ? `✓ Sistem mendeteksi ${detectedCount} data terkait`
                  : "Belum ada data terdeteksi"}
              </p>
            ) : null}
          </div>
        </div>

        {/* Body — varies per kind */}
        {step.kind === "trial_date" ? (
          <TrialDateBody
            value={trialStartDate}
            onChange={onTrialDate}
            hint={step.hint}
          />
        ) : step.kind === "inline_kasbon" ? (
          <KasbonInlineBody
            hint={step.hint}
            onChanged={onRefreshAuto}
          />
        ) : step.kind === "inline_bank" ? (
          <BankBalanceInlineBody
            hint={step.hint}
            defaultDate={trialStartDate}
            onChanged={onRefreshAuto}
          />
        ) : (
          <DeepLinkBody step={step} />
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          <button
            type="button"
            onClick={() => onMarkStatus("done")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              status === "done"
                ? "border-success-500/60 bg-success-100 text-success-700"
                : "border-neutral-300 bg-white text-neutral-700 hover:border-success-500/60 hover:bg-success-50/40",
            )}
          >
            <Check className="size-3" aria-hidden /> Tandai Selesai
          </button>
          <button
            type="button"
            onClick={() => onMarkStatus("skip")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              status === "skip"
                ? "border-neutral-400 bg-neutral-200 text-neutral-700"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
            )}
          >
            Skip dulu
          </button>
          {status !== "pending" ? (
            <button
              type="button"
              onClick={() => onMarkStatus("pending")}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
            >
              Reset
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Body variants ------------------------------ */

function TrialDateBody({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-4">
      <div className="max-w-xs">
        <DatePicker
          label="Tanggal Trial"
          value={value || null}
          onChange={(v) => onChange(v ?? "")}
          placeholder="Pilih tanggal trial"
          clearable
        />
        {value ? (
          <p className="mt-2 text-xs text-mahakan-green-700">
            ✓ Trial start tersimpan di setting outlet
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-neutral-600">{hint}</p>
      </div>
    </div>
  );
}

function DeepLinkBody({ step }: { step: WizardStep }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-start gap-2">
        <ArrowRight
          className="mt-0.5 size-4 shrink-0 text-mahakan-green-700"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-mahakan-green-900">
            {step.menuLabel}
          </div>
          <div className="mt-1 whitespace-pre-line text-xs text-neutral-700">
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
          {step.targetSection ? (
            <button
              type="button"
              onClick={() => {
                window.location.hash = "#" + step.targetSection;
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-mahakan-green-500/60 bg-mahakan-green-50 px-3 py-1.5 text-xs font-semibold text-mahakan-green-700 hover:bg-mahakan-green-100"
            >
              <ExternalLink className="size-3" aria-hidden /> Buka{" "}
              {step.menuLabel.split("→")[0].trim()}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Inline: Kasbon ------------------------------- */

function KasbonInlineBody({
  hint,
  onChanged,
}: {
  hint: string;
  onChanged: () => Promise<void>;
}) {
  const today = todayJakarta();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [issuedDate, setIssuedDate] = useState(today);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listEmployees({ limit: 200 }).then((res) => {
      if (cancelled) return;
      if (isOk(res)) {
        setEmployees(res.data.items.filter((e) => e.status === "active"));
      }
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  let parsedAmount = 0;
  try {
    parsedAmount = parseRupiah(amount);
  } catch {
    parsedAmount = 0;
  }

  async function onSubmit() {
    if (!employeeId) {
      toast.error("Pilih karyawan dulu");
      return;
    }
    if (parsedAmount < 1) {
      toast.error("Nominal minimal Rp 1");
      return;
    }
    setSubmitting(true);
    const res = await createEmployeeAdvance({
      employeeId,
      amount: parsedAmount,
      issuedDate,
      reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const empName = employees.find((e) => e.id === employeeId)?.fullName ?? "";
    toast.success(
      `Kasbon ${formatRupiah(parsedAmount)} untuk ${empName} dicatat`,
    );
    setAmount("");
    setReason("");
    setEmployeeId("");
    await onChanged();
  }

  return (
    <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-4">
      <p className="mb-3 text-[11px] text-neutral-600">{hint}</p>

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat
          daftar karyawan…
        </div>
      ) : employees.length === 0 ? (
        <div className="rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          Belum ada karyawan aktif. Tambahkan dulu via HR Operations →
          Karyawan.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Karyawan"
              placeholder="— Pilih karyawan —"
              options={employees.map((e) => ({
                value: e.id,
                label: e.fullName,
              }))}
              value={employeeId || undefined}
              onValueChange={setEmployeeId}
            />
            <Input
              label="Nominal Kasbon"
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^\d]/g, ""))
              }
              placeholder="500000"
              hint={
                parsedAmount > 0 ? `Preview: ${formatRupiah(parsedAmount)}` : undefined
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker
              label="Tanggal Kasbon"
              value={issuedDate}
              onChange={(v) => setIssuedDate(v ?? today)}
              clearable={false}
            />
            <Input
              label="Alasan (opsional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. uang muka servis motor"
              maxLength={500}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={onSubmit} loading={submitting} disabled={submitting}>
              <Plus className="size-4" aria-hidden /> Tambah Kasbon
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------- Inline: Bank balance ----------------------------- */

interface BankRowDraft {
  bankAccountId: string;
  amount: string;
}

function BankBalanceInlineBody({
  hint,
  defaultDate,
  onChanged,
}: {
  hint: string;
  defaultDate: string;
  onChanged: () => Promise<void>;
}) {
  const today = todayJakarta();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [rows, setRows] = useState<BankRowDraft[]>([
    { bankAccountId: "", amount: "" },
  ]);
  const [date, setDate] = useState(defaultDate || today);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listBankAccounts().then((res) => {
      if (cancelled) return;
      if (res.ok) setAccounts(res.data);
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
  }, [defaultDate]);

  function updateRow(idx: number, patch: Partial<BankRowDraft>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { bankAccountId: "", amount: "" }]);
  }
  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  async function onSubmit() {
    const validRows = rows
      .map((r) => {
        let amt = 0;
        try {
          amt = parseRupiah(r.amount);
        } catch {
          amt = 0;
        }
        return { ...r, parsedAmount: amt };
      })
      .filter((r) => r.bankAccountId && r.parsedAmount > 0);

    if (validRows.length === 0) {
      toast.error("Isi minimal 1 row valid (pilih rekening + nominal > 0)");
      return;
    }

    setSubmitting(true);
    let okCount = 0;
    let failCount = 0;
    let lastError = "";

    for (const r of validRows) {
      const bank = accounts.find((a) => a.id === r.bankAccountId);
      if (!bank) {
        failCount++;
        continue;
      }
      // Map bank type to CashPaymentMethod for jurnal routing.
      // BCA → "transfer" (akun 1110), bank lain → "other" (akun 1112).
      // Resolver di accounting hook akan pakai bankAccountId untuk derive
      // akun GL specific kalau ada master rekening match.
      const method = bank.bankName.toUpperCase().includes("BCA")
        ? ("transfer" as const)
        : ("other" as const);
      const description = `Saldo Awal Bank — ${formatBankAccountDisplay(bank)}`;
      const res = await createIncome({
        incomeDate: date,
        description,
        amount: r.parsedAmount,
        paymentMethod: method,
        bankAccountId: r.bankAccountId,
        accountId: null,
      });
      if (isOk(res)) {
        okCount++;
      } else {
        failCount++;
        lastError = res.error.message;
      }
    }

    setSubmitting(false);
    if (okCount > 0) {
      toast.success(
        `${okCount} saldo bank tercatat${failCount > 0 ? ` (${failCount} gagal: ${lastError})` : ""}`,
      );
      setRows([{ bankAccountId: "", amount: "" }]);
      await onChanged();
    } else {
      toast.error(`Gagal semua: ${lastError || "unknown error"}`);
    }
  }

  return (
    <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-4">
      <p className="mb-3 text-[11px] text-neutral-600">{hint}</p>

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat
          daftar rekening…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          Belum ada master rekening bank. Set dulu via Pengaturan → Rekening
          Bank, baru lanjut step ini.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="max-w-xs">
            <DatePicker
              label="Tanggal Saldo (= tanggal trial start)"
              value={date}
              onChange={(v) => setDate(v ?? today)}
              clearable={false}
            />
          </div>

          {rows.map((r, idx) => {
            let preview = 0;
            try {
              preview = parseRupiah(r.amount);
            } catch {
              preview = 0;
            }
            return (
              <div
                key={idx}
                className="grid items-end gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Select
                  label={idx === 0 ? "Rekening Bank" : undefined}
                  placeholder="— Pilih rekening —"
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: formatBankAccountDisplay(a),
                  }))}
                  value={r.bankAccountId || undefined}
                  onValueChange={(v) => updateRow(idx, { bankAccountId: v })}
                />
                <Input
                  label={idx === 0 ? "Saldo Awal" : undefined}
                  type="text"
                  inputMode="numeric"
                  value={r.amount}
                  onChange={(e) =>
                    updateRow(idx, {
                      amount: e.target.value.replace(/[^\d]/g, ""),
                    })
                  }
                  placeholder="5000000"
                  hint={preview > 0 ? formatRupiah(preview) : undefined}
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={rows.length === 1}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-2 text-danger-500 hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Hapus row"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            );
          })}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Plus className="size-3" aria-hidden /> Tambah Rekening
            </button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={submitting}
            >
              <Plus className="size-4" aria-hidden /> Simpan{" "}
              {rows.filter((r) => r.bankAccountId && r.amount).length} Saldo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Done Screen ------------------------------- */

function DoneScreen({
  autoStatus,
  steps,
  onBack,
  onRestart,
}: {
  autoStatus: OpeningBalanceAutoStatus | null;
  steps: Record<string, StepStatus>;
  onBack: () => void;
  onRestart: () => void;
}) {
  const doneCount = STEPS.filter((s) => steps[s.key] === "done").length;
  const allDone = doneCount === STEPS.length;

  return (
    <Card className={cn(allDone && "border-success-500/60 bg-success-50/40")}>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-lg",
              allDone
                ? "bg-success-100 text-success-700"
                : "bg-mahakan-green-100 text-mahakan-green-700",
            )}
          >
            {allDone ? (
              <Sparkles className="size-6" aria-hidden />
            ) : (
              <CheckCircle2 className="size-6" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-mahakan-green-900">
              {allDone ? "🎉 Setup Saldo Awal Selesai!" : "Ringkasan Setup"}
            </h2>
            <p className="mt-1 text-sm text-neutral-700">
              {allDone
                ? "Semua step sudah ditandai selesai. Sistem ready untuk import histori bulan-bulan lampau."
                : `${doneCount} dari ${STEPS.length} step selesai. Anda bisa lanjut import histori sekarang, atau balik selesaikan step yang tersisa.`}
            </p>
          </div>
        </div>

        {/* Summary table */}
        <div className="rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Step</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Data Terdeteksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {STEPS.map((s) => {
                const status = steps[s.key] ?? "pending";
                const detected =
                  autoStatus && s.autoDetectCount
                    ? s.autoDetectCount(autoStatus)
                    : null;
                return (
                  <tr key={s.key}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-neutral-500">
                          {s.n}.
                        </span>
                        <span className="text-neutral-900">{s.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          status === "done" && "bg-success-100 text-success-700",
                          status === "skip" && "bg-neutral-100 text-neutral-600",
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
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-neutral-700">
                      {detected != null
                        ? detected > 0
                          ? `${detected} data`
                          : "—"
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Next steps CTA */}
        <div className="rounded-md border border-mahakan-green-300 bg-mahakan-green-50/40 p-4">
          <h3 className="text-sm font-semibold text-mahakan-green-900">
            Langkah Berikutnya
          </h3>
          <p className="mt-1 text-xs text-neutral-700">
            Setelah saldo awal beres, lanjut ke <strong>Import Histori</strong>{" "}
            untuk upload CSV penjualan 3-6 bulan terakhir dari Majoo / Kasir
            Pintar. Data ini akan otomatis muncul di Laporan Penjualan, P&amp;L,
            dan Cash Flow dengan badge &ldquo;Histori&rdquo;.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                /* Switch ke tab Import Histori via custom event. */
                window.dispatchEvent(
                  new CustomEvent("reconciliation:switch-tab", {
                    detail: { tab: "import" },
                  }),
                );
              }}
            >
              Lanjut ke Import Histori <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden /> Balik ke Step
              Terakhir
            </Button>
            <Button variant="ghost" onClick={onRestart}>
              Mulai dari Step 1
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
