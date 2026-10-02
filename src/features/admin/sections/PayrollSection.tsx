"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  DollarSign,
  Gift,
  Landmark,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DatePicker,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  applyThr,
  computePayrollLines,
  createPayrollPeriod,
  deletePayrollPeriod,
  finalizePayrollPeriod,
  isOk,
  listPayrollLines,
  listPayrollPeriods,
  updatePayrollLine,
  type PayrollLineWithEmployee,
  type PayrollStatus,
} from "@/features/payroll";
import {
  PayrollPaymentModal,
  type PayrollPaymentMode,
} from "./payroll/PayrollPaymentModal";
import {
  formatBankAccountDisplay,
  listBankAccounts,
} from "@/features/bank-accounts";
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updatePayrollSettings,
} from "@/features/outlets";
import type { Role } from "@/lib/auth";
import {
  formatRupiah,
  parseIndonesianNumber,
  parseRupiah,
} from "@/lib/format";
import {
  amountFromMinutes,
  resolveHourlyRates,
} from "@/features/payroll/hourly-rate-pure";
import { formatIndonesianDateTime } from "@/lib/date";
import { jakartaDateOf, monthEndJakarta, monthStartJakarta } from "@/lib/tz";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<PayrollStatus, { variant: "warning" | "info" | "success"; label: string }> =
  {
    draft: { variant: "warning", label: "Draft" },
    finalized: { variant: "info", label: "Finalized" },
    paid: { variant: "success", label: "Paid" },
  };

interface PayrollSectionProps {
  viewerRole: Role;
}

export function PayrollSection({ viewerRole }: PayrollSectionProps) {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const [editingLine, setEditingLine] =
    useState<PayrollLineWithEmployee | null>(null);

  /* Sesi AE-210 — modal pilih rekening. "pay" = saat menandai lunas,
   * "correct" = saat rekening yang tercatat ternyata salah. */
  const [paymentModalMode, setPaymentModalMode] =
    useState<PayrollPaymentMode | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [latePerMin, setLatePerMin] = useState<string>("");
  const [otPerMin, setOtPerMin] = useState<string>("");
  /* Sesi AE-62ac — double-shift bonus state (owner-config). */
  const [dsEnabled, setDsEnabled] = useState(false);
  const [dsMinHours, setDsMinHours] = useState<string>("10");
  const [dsBonusType, setDsBonusType] = useState<"fixed" | "multiplier">(
    "fixed",
  );
  const [dsBonusValue, setDsBonusValue] = useState<string>("100000");

  const canManage = viewerRole === "owner";

  const {
    data: periods = [],
    isLoading: loadingPeriods,
  } = useQuery({
    queryKey: ["admin", "payroll", "periods"],
    queryFn: async () => {
      const res = await listPayrollPeriods();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const {
    data: lines = [],
    isLoading: loadingLines,
  } = useQuery({
    queryKey: ["admin", "payroll", "lines", selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return [];
      const res = await listPayrollLines(selectedPeriodId);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: selectedPeriodId !== null,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "payroll"] });
  };

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (outletIsOk(res)) {
        const p = res.data.settings?.payroll ?? {};
        /* Sesi AE-244 — tarif kini per JAM; tarif lama per menit ikut
         * dinaikkan ×60 supaya kotaknya tidak tampil kosong. */
        const rates = resolveHourlyRates(p);
        setLatePerMin(rates.latePerHour ? String(rates.latePerHour) : "");
        setOtPerMin(rates.overtimePerHour ? String(rates.overtimePerHour) : "");
        /* Sesi AE-62ac — load doubleShift config. */
        const ds = p.doubleShift;
        if (ds) {
          setDsEnabled(true);
          setDsMinHours(String(Math.round(ds.minMinutes / 60)));
          setDsBonusType(ds.bonusType);
          setDsBonusValue(String(ds.bonusValue));
        } else {
          setDsEnabled(false);
        }
        setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  async function handleSaveSettings() {
    if (savingSettings) return;
    const lateNum = latePerMin.trim() === "" ? 0 : parseInt(latePerMin, 10);
    const otNum = otPerMin.trim() === "" ? 0 : parseInt(otPerMin, 10);
    if (
      !Number.isFinite(lateNum) ||
      lateNum < 0 ||
      !Number.isFinite(otNum) ||
      otNum < 0
    ) {
      toast.error("Rate harus angka non-negatif");
      return;
    }

    /* Sesi AE-62ac — validate + build doubleShift payload. */
    let doubleShiftPayload:
      | { minMinutes: number; bonusType: "fixed" | "multiplier"; bonusValue: number }
      | null = null;
    if (dsEnabled) {
      /* Sesi AE-136 — strict Indonesian parser. */
      const hrs = parseIndonesianNumber(dsMinHours);
      const val = parseIndonesianNumber(dsBonusValue);
      if (!Number.isFinite(hrs) || hrs < 1 || hrs > 24) {
        toast.error("Min jam double-shift harus 1-24 (pakai koma untuk desimal)");
        return;
      }
      if (!Number.isFinite(val) || val <= 0) {
        toast.error(
          dsBonusType === "fixed"
            ? "Bonus rupiah harus > 0"
            : "Multiplier harus > 0 (mis. 1.5 = 50% extra)",
        );
        return;
      }
      if (dsBonusType === "multiplier" && val < 1) {
        toast.error("Multiplier minimum 1.0 (kalau 1.0 = no extra)");
        return;
      }
      doubleShiftPayload = {
        minMinutes: Math.round(hrs * 60),
        bonusType: dsBonusType,
        bonusValue: dsBonusType === "fixed" ? Math.round(val) : val,
      };
    }

    setSavingSettings(true);
    const res = await updatePayrollSettings({
      latePerHour: lateNum,
      overtimePerHour: otNum,
      doubleShift: doubleShiftPayload,
    });
    setSavingSettings(false);
    if (!outletIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Formula payroll disimpan");
    setSettingsOpen(false);
  }

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  /* Sesi AE-210 — nama rekening sumber pembayaran, buat ditampilkan di
   * baris "Paid". Master rekening jarang berubah, jadi di-cache lama dan
   * memakai queryKey yang sama dengan BankAccountSelect supaya satu fetch
   * dipakai bersama. */
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", "list", "active"],
    queryFn: async () => {
      const res = await listBankAccounts();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const paidBankLabel = useMemo(() => {
    if (!selectedPeriod?.bankAccountId) return null;
    const b = bankAccounts.find(
      (x) => x.id === selectedPeriod.bankAccountId,
    );
    return b ? formatBankAccountDisplay(b) : null;
  }, [bankAccounts, selectedPeriod]);

  async function handleCompute(force = false) {
    if (!selectedPeriod) return;
    const res = await computePayrollLines(selectedPeriod.id, { force });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    /* Sesi AE-60 — kalau backend balikin needsConfirm, tampilkan warning
     * sebelum overwrite manual edits (bonus/THR/kasbon). */
    if ("needsConfirm" in res.data) {
      const proceed = confirm(
        `${res.data.manualEditCount} dari ${res.data.totalLines} line punya manual edit (bonus/THR/kasbon/other deductions). Recompute akan TIMPA semua. Lanjut?`,
      );
      if (!proceed) return;
      void handleCompute(true);
      return;
    }
    const warnings =
      res.data.warnings.length > 0
        ? ` · ${res.data.warnings.length} warning`
        : "";
    const advLink =
      res.data.totalAdvancesLinked > 0
        ? ` · Kasbon ter-link Rp ${res.data.totalAdvancesLinked.toLocaleString("id-ID")}`
        : "";
    toast.success(`${res.data.lineCount} line di-compute${warnings}${advLink}`);
    if (res.data.warnings.length > 0) {
      // Surface first warning prominently
      toast.error(
        `⚠ ${res.data.warnings[0].employeeName}: ${res.data.warnings[0].message}`,
      );
    }
    refresh();
  }

  /* Sesi AE-60 — Apply THR semua line di period sekaligus.
   * Multiplier dari outlet settings (default 1.0 = 1× baseSalary). */
  async function handleApplyThr() {
    if (!selectedPeriod) return;
    const proceed = confirm(
      `Hitung THR untuk semua line di "${selectedPeriod.label}"? Field THR akan di-overwrite dengan baseSalary × multiplier (default 1.0×).`,
    );
    if (!proceed) return;
    const res = await applyThr({ periodId: selectedPeriod.id });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `THR di-apply ke ${res.data.updatedCount} line · Total Rp ${res.data.totalThr.toLocaleString("id-ID")}`,
    );
    refresh();
  }

  async function handleFinalize() {
    if (!selectedPeriod) return;
    if (!confirm(`Finalize payroll "${selectedPeriod.label}"? Setelah ini line tidak bisa diedit non-Owner.`))
      return;
    const res = await finalizePayrollPeriod(selectedPeriod.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Payroll di-finalize");
    refresh();
  }

  /* Sesi AE-210 — tombol ini dulu langsung memanggil markPayrollPaid tanpa
   * menanyakan apa pun, dan jurnalnya SELALU mengkredit 1110 Bank BCA. Gaji
   * yang ditransfer dari BRI tetap tercatat keluar dari BCA → saldo BCA
   * minus. Sekarang rekeningnya ditanyakan dulu lewat modal. */
  function handleMarkPaid() {
    if (!selectedPeriod) return;
    setPaymentModalMode("pay");
  }

  async function handleDelete() {
    if (!selectedPeriod) return;
    if (!confirm(`Hapus periode payroll "${selectedPeriod.label}"?`)) return;
    const res = await deletePayrollPeriod(selectedPeriod.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Periode dihapus");
    setSelectedPeriodId(null);
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <DollarSign className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Payroll
            </h1>
            <p className="text-sm text-neutral-600">
              Periode bulanan + recompute dari attendance + adjust per line.
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              disabled={!settingsLoaded}
              aria-label="Pengaturan formula payroll"
            >
              <SettingsIcon className="size-4" aria-hidden /> Formula
            </Button>
            <Button onClick={() => setCreateOpen(true)} size="lg">
              <Plus className="size-4" aria-hidden /> Periode Baru
            </Button>
          </div>
        ) : null}
      </header>

      <Modal
        open={settingsOpen}
        onClose={() => (savingSettings ? null : setSettingsOpen(false))}
        title="Formula Payroll"
        description="Tarif per JAM untuk auto-isi saat Recompute. Kosongkan / 0 = tidak auto-isi (Owner input manual)."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setSettingsOpen(false)}
              disabled={savingSettings}
            >
              Batal
            </Button>
            <Button
              onClick={handleSaveSettings}
              loading={savingSettings}
              size="lg"
            >
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Potongan Telat (Rp/jam)"
            type="text"
            inputMode="numeric"
            value={latePerMin}
            onChange={(e) =>
              setLatePerMin(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="0"
            hint={
              latePerMin && parseInt(latePerMin, 10) > 0
                ? `Contoh: telat 30 menit → ${formatRupiah(amountFromMinutes(30, parseInt(latePerMin, 10)))}`
                : "Default 0 = tidak auto-isi potongan telat"
            }
            disabled={savingSettings}
          />
          <Input
            label="Upah Lembur (Rp/jam)"
            type="text"
            inputMode="numeric"
            value={otPerMin}
            onChange={(e) =>
              setOtPerMin(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="0"
            hint={
              otPerMin && parseInt(otPerMin, 10) > 0
                ? `Contoh: lembur 2 jam → ${formatRupiah(amountFromMinutes(120, parseInt(otPerMin, 10)))}`
                : "Default 0 = tidak auto-isi upah lembur"
            }
            disabled={savingSettings}
          />
          <p className="rounded-md bg-mahakan-green-50 p-3 text-xs text-mahakan-green-900">
            Diaplikasikan saat klik &ldquo;Recompute&rdquo; di periode draft.
            Owner masih bisa override per line lewat tombol pencil.
          </p>

          {/* Sesi AE-62ac — Bonus Double-Shift section */}
          <div className="rounded-md border border-neutral-200 bg-white p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-mahakan-green-900">
                  Bonus Double-Shift / Full-Shift
                </p>
                <p className="text-[11px] text-neutral-600">
                  Tambahan otomatis untuk karyawan yang kerja shift panjang
                  (mis. weekend Mahakan 08:00-23:00 = 15 jam, atau
                  tanggal merah). Berlaku untuk fixed & daily salary.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dsEnabled}
                onClick={() => setDsEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  dsEnabled
                    ? "border-mahakan-green-700 bg-mahakan-green-700"
                    : "border-neutral-300 bg-neutral-200"
                }`}
              >
                <span
                  className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                    dsEnabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {dsEnabled ? (
              <div className="space-y-2">
                <Input
                  label="Min Jam Kerja per Hari = Double-Shift"
                  type="text"
                  inputMode="decimal"
                  value={dsMinHours}
                  onChange={(e) =>
                    setDsMinHours(e.target.value.replace(/[^\d.,]/g, ""))
                  }
                  hint="Default 10 jam. Karyawan yang work ≥ ini per hari dapat bonus."
                  disabled={savingSettings}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDsBonusType("fixed")}
                    disabled={savingSettings}
                    className={`rounded-md border py-2 text-xs font-medium transition-colors ${
                      dsBonusType === "fixed"
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    Rupiah flat
                  </button>
                  <button
                    type="button"
                    onClick={() => setDsBonusType("multiplier")}
                    disabled={savingSettings}
                    className={`rounded-md border py-2 text-xs font-medium transition-colors ${
                      dsBonusType === "multiplier"
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    Multiplier × base
                  </button>
                </div>
                <Input
                  label={
                    dsBonusType === "fixed"
                      ? "Bonus (Rp per hari double-shift)"
                      : "Multiplier (mis. 1.5 = 50% extra atas base)"
                  }
                  type="text"
                  inputMode="decimal"
                  value={dsBonusValue}
                  onChange={(e) =>
                    setDsBonusValue(e.target.value.replace(/[^\d.,]/g, ""))
                  }
                  hint={
                    dsBonusType === "fixed"
                      ? "Contoh: 100000 → tiap hari double, +Rp 100.000 di gross"
                      : "Contoh: 1.5 → +50% atas base daily (dailyRate atau salary/30)"
                  }
                  disabled={savingSettings}
                />
              </div>
            ) : (
              <p className="text-[11px] text-neutral-500">
                Toggle ON untuk aktifkan. Off = bonus=0 (legacy behavior).
              </p>
            )}
          </div>
        </div>
      </Modal>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Period sidebar — wider untuk fit "2026-05-31" + label */}
        <Card>
          <CardContent className="px-0 py-2">
            <p className="border-b border-neutral-200 px-4 py-2 text-xs uppercase tracking-wider text-neutral-500">
              Periode
            </p>
            {loadingPeriods ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : periods.length === 0 ? (
              <div className="p-2">
                <EmptyCard
                  icon={DollarSign}
                  title="Belum ada periode"
                  description="Buat periode payroll baru untuk mulai compute gaji."
                />
              </div>
            ) : (
              <ul className="space-y-0.5 p-2">
                {periods.map((p) => {
                  const status = STATUS_LABELS[p.status as PayrollStatus];
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPeriodId(p.id)}
                        className={cn(
                          "w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                          selectedPeriodId === p.id
                            ? "bg-mahakan-green-100 text-mahakan-green-900"
                            : "hover:bg-neutral-100",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">
                            {p.label}
                          </span>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-neutral-600">
                          {p.periodStart} → {p.periodEnd}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-neutral-500">
                          <span>{p.lineCount} karyawan</span>
                          <span className="font-mono font-semibold text-neutral-700">
                            {formatRupiah(p.netPayTotal)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Detail panel */}
        <div className="space-y-4 min-w-0">
          {!selectedPeriod ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-sm italic text-neutral-500">
                  Pilih periode di kiri untuk lihat detail.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header card: title + status + meta + action buttons grouped */}
              <Card>
                <CardContent className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-neutral-900">
                          {selectedPeriod.label}
                        </h2>
                        <Badge
                          variant={
                            STATUS_LABELS[
                              selectedPeriod.status as PayrollStatus
                            ].variant
                          }
                        >
                          {
                            STATUS_LABELS[
                              selectedPeriod.status as PayrollStatus
                            ].label
                          }
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-neutral-600">
                        {selectedPeriod.periodStart} →{" "}
                        {selectedPeriod.periodEnd}
                      </p>
                      {selectedPeriod.finalizedAt ? (
                        <p className="text-[11px] text-neutral-500">
                          Finalized{" "}
                          {formatIndonesianDateTime(
                            selectedPeriod.finalizedAt,
                          )}
                        </p>
                      ) : null}
                      {selectedPeriod.paidAt ? (
                        <p className="text-[11px] text-mahakan-green-700">
                          Paid{" "}
                          {formatIndonesianDateTime(selectedPeriod.paidAt)}
                          {/* Sesi AE-210 — rekening sumbernya ditampilkan di
                            * sini supaya salah-rekening ketahuan tanpa harus
                            * membuka Buku Besar. Periode lama belum punya
                            * datanya, jadi ditandai jujur apa adanya. */}
                          {selectedPeriod.paymentMethod === "cash"
                            ? " · tunai dari kas"
                            : selectedPeriod.bankAccountId
                              ? ` · transfer dari ${
                                  paidBankLabel ?? "rekening terdaftar"
                                }`
                              : " · rekening belum dicatat"}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Group 1: compute */}
                        <div className="flex gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCompute(false)}
                            disabled={selectedPeriod.status !== "draft"}
                          >
                            <RefreshCw className="size-3.5" aria-hidden />{" "}
                            Recompute
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleApplyThr}
                            disabled={selectedPeriod.status !== "draft"}
                            title="Hitung THR semua line × multiplier (default 1× baseSalary)"
                          >
                            <Gift className="size-3.5" aria-hidden /> THR
                          </Button>
                        </div>
                        {/* Group 2: status flow */}
                        <div className="flex gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleFinalize}
                            disabled={selectedPeriod.status !== "draft"}
                          >
                            <Lock className="size-3.5" aria-hidden />{" "}
                            Finalize
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleMarkPaid}
                            disabled={selectedPeriod.status !== "finalized"}
                          >
                            <CheckCircle2
                              className="size-3.5"
                              aria-hidden
                            />{" "}
                            Mark Paid
                          </Button>
                          {/* Sesi AE-210 — jalan keluar kalau rekeningnya
                            * terlanjur salah: jurnal dibalik lalu diposting
                            * ulang ke akun bank yang benar. */}
                          {selectedPeriod.status === "paid" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPaymentModalMode("correct")}
                              title="Koreksi rekening/metode pembayaran gaji"
                            >
                              <Landmark className="size-3.5" aria-hidden />{" "}
                              Koreksi Rekening
                            </Button>
                          ) : null}
                        </div>
                        {/* Group 3: danger */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleDelete}
                          disabled={selectedPeriod.status === "paid"}
                          className="!text-danger-500 hover:!bg-danger-100/40"
                          aria-label="Hapus periode"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              {/* Stat cards */}
              {lines.length > 0 ? (
                <PayrollStatsRow lines={lines} />
              ) : null}

              {/* Lines table */}
              <Card>
                <CardContent className="p-0">
                  {loadingLines ? (
                    <div className="space-y-2 p-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : lines.length === 0 ? (
                    <div className="p-4">
                      <EmptyCard
                        icon={RefreshCw}
                        title="Belum ada line"
                        description="Klik &ldquo;Recompute&rdquo; untuk generate line dari attendance periode ini."
                      />
                    </div>
                  ) : (
                    <PayrollLinesTable
                      lines={lines}
                      canManage={canManage}
                      isPaid={selectedPeriod.status === "paid"}
                      onEdit={(l) => setEditingLine(l)}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <CreatePeriodDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setSelectedPeriodId(id);
          refresh();
        }}
      />

      <EditLineDialog
        line={editingLine}
        onClose={() => setEditingLine(null)}
        onSaved={() => {
          setEditingLine(null);
          refresh();
        }}
      />

      {/* Sesi AE-210 — pilih/koreksi rekening asal pembayaran gaji. */}
      {paymentModalMode && selectedPeriod ? (
        <PayrollPaymentModal
          mode={paymentModalMode}
          periodId={selectedPeriod.id}
          periodLabel={selectedPeriod.label}
          totalNetPay={selectedPeriod.netPayTotal}
          currentPaymentMethod={selectedPeriod.paymentMethod}
          currentBankAccountId={selectedPeriod.bankAccountId}
          onClose={() => setPaymentModalMode(null)}
          onSaved={() => {
            setPaymentModalMode(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CreatePeriodDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (periodId: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const now = new Date();
    const monthLabel = now.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
    setLabel(monthLabel);
    /* Sesi AE-191 — periode gaji ikut kalender WIB, bukan UTC. */
    const iso = jakartaDateOf(now);
    setPeriodStart(monthStartJakarta(iso));
    setPeriodEnd(monthEndJakarta(iso));
    setNotes("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (label.trim().length === 0) {
      setError("Label wajib");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Tanggal wajib");
      return;
    }
    setSubmitting(true);
    const res = await createPayrollPeriod({
      label: label.trim(),
      periodStart,
      periodEnd,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`Periode "${res.data.label}" dibuat`);
    onCreated(res.data.id);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Periode Payroll Baru"
      description="Setelah dibuat, klik Recompute untuk generate line dari attendance."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting} size="lg">
            Buat
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 100))}
          placeholder="Mis. April 2026"
          required
          disabled={submitting}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label="Mulai"
            value={periodStart || null}
            onChange={(v) => setPeriodStart(v ?? "")}
            required
            disabled={submitting}
            clearable={false}
          />
          <DatePicker
            label="Selesai"
            value={periodEnd || null}
            onChange={(v) => setPeriodEnd(v ?? "")}
            minDate={periodStart || undefined}
            required
            disabled={submitting}
            clearable={false}
          />
        </div>
        <Input
          label="Catatan (opsional)"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          disabled={submitting}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function EditLineDialog({
  line,
  onClose,
  onSaved,
}: {
  line: PayrollLineWithEmployee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseSalary, setBaseSalary] = useState("");
  const [overtimePay, setOvertimePay] = useState("");
  const [lateDeduction, setLateDeduction] = useState("");
  const [bonus, setBonus] = useState("");
  /* Sesi AE-60 */
  const [thr, setThr] = useState("");
  const [advanceDeduction, setAdvanceDeduction] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!line) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setBaseSalary(String(line.baseSalary));
    setOvertimePay(String(line.overtimePay));
    setLateDeduction(String(line.lateDeduction));
    setBonus(String(line.bonus));
    setThr(String(line.thr ?? 0));
    setAdvanceDeduction(String(line.advanceDeduction ?? 0));
    setOtherDeductions(String(line.otherDeductions));
    setNotes(line.notes ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [line]);

  function tryParse(s: string): number {
    const trimmed = s.trim();
    if (trimmed.length === 0) return 0;
    try {
      const n = parseRupiah(trimmed);
      return n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  async function handleSave() {
    if (!line) return;
    if (submitting) return;
    setSubmitting(true);
    const res = await updatePayrollLine({
      id: line.id,
      baseSalary: tryParse(baseSalary),
      overtimePay: tryParse(overtimePay),
      lateDeduction: tryParse(lateDeduction),
      bonus: tryParse(bonus),
      thr: tryParse(thr),
      advanceDeduction: tryParse(advanceDeduction),
      otherDeductions: tryParse(otherDeductions),
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Line disimpan");
    onSaved();
  }

  if (!line) return null;

  const previewGross =
    tryParse(baseSalary) +
    tryParse(overtimePay) +
    tryParse(bonus) +
    tryParse(thr);
  const previewNet = Math.max(
    0,
    previewGross -
      tryParse(lateDeduction) -
      tryParse(advanceDeduction) -
      tryParse(otherDeductions),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit Line — ${line.employeeFullName}`}
      description={`Hari ${line.workDays} · Telat ${line.totalLateMinutes}m · OT ${line.totalOvertimeMinutes}m`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSave} loading={submitting} size="lg">
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Base Salary (snapshot)"
          type="text"
          inputMode="numeric"
          value={baseSalary}
          onChange={(e) => setBaseSalary(e.target.value.replace(/[^\d]/g, ""))}
          disabled={submitting}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Overtime Pay"
            type="text"
            inputMode="numeric"
            value={overtimePay}
            onChange={(e) =>
              setOvertimePay(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Bonus"
            type="text"
            inputMode="numeric"
            value={bonus}
            onChange={(e) => setBonus(e.target.value.replace(/[^\d]/g, ""))}
            disabled={submitting}
          />
          <Input
            label="THR (Tunjangan Hari Raya)"
            type="text"
            inputMode="numeric"
            value={thr}
            onChange={(e) => setThr(e.target.value.replace(/[^\d]/g, ""))}
            disabled={submitting}
          />
          <Input
            label="Late Deduction"
            type="text"
            inputMode="numeric"
            value={lateDeduction}
            onChange={(e) =>
              setLateDeduction(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Kasbon (Advance)"
            type="text"
            inputMode="numeric"
            value={advanceDeduction}
            onChange={(e) =>
              setAdvanceDeduction(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Other Deductions"
            type="text"
            inputMode="numeric"
            value={otherDeductions}
            onChange={(e) =>
              setOtherDeductions(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
        </div>
        <Input
          label="Catatan (opsional)"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          disabled={submitting}
        />
        <div className="rounded-md bg-mahakan-green-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-700">Gross</span>
            <span className="font-mono font-semibold">
              {formatRupiah(previewGross)}
            </span>
          </div>
          <div className="flex justify-between border-t border-mahakan-green-200 pt-2 mt-2 text-mahakan-green-900">
            <span className="font-semibold">Net</span>
            <span className="font-mono text-lg font-bold">
              {formatRupiah(previewNet)}
            </span>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ============================================================
 * Sesi AE-60 polish — PayrollStatsRow + PayrollLinesTable
 *
 * Custom layout untuk fix HR feedback "kurang rapih dan bocor":
 * - Stat cards summary 4-up untuk visual hierarchy jelas
 * - Tabel custom dengan sticky-left Karyawan + grouped columns
 *   (Income vs Deduction) supaya 12+ kolom muat tanpa overlap
 * ============================================================ */

function PayrollStatsRow({ lines }: { lines: PayrollLineWithEmployee[] }) {
  const totals = useMemo(() => {
    const totalEmployees = lines.length;
    let dailyCount = 0;
    let monthlyCount = 0;
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    for (const l of lines) {
      if (l.employeePaymentType === "daily") dailyCount++;
      else monthlyCount++;
      totalGross += l.grossPay;
      totalDeductions += l.lateDeduction + l.advanceDeduction + l.otherDeductions;
      totalNet += l.netPay;
    }
    return {
      totalEmployees,
      dailyCount,
      monthlyCount,
      totalGross,
      totalDeductions,
      totalNet,
    };
  }, [lines]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <PayrollStatCard
        label="Karyawan"
        value={String(totals.totalEmployees)}
        sublabel={`${totals.dailyCount} harian · ${totals.monthlyCount} bulanan`}
        tone="neutral"
      />
      <PayrollStatCard
        label="Gross Pay"
        value={formatRupiah(totals.totalGross)}
        sublabel="Base + OT + Bonus + THR"
        tone="info"
      />
      <PayrollStatCard
        label="Total Deductions"
        value={formatRupiah(totals.totalDeductions)}
        sublabel="Telat + Kasbon + Other"
        tone="warn"
      />
      <PayrollStatCard
        label="Net Pay"
        value={formatRupiah(totals.totalNet)}
        sublabel="Yang akan dibayar"
        tone="success"
      />
    </div>
  );
}

function PayrollStatCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: "neutral" | "info" | "warn" | "success";
}) {
  const toneCls = {
    neutral: "text-neutral-900",
    info: "text-info-500",
    warn: "text-warning-500",
    success: "text-mahakan-green-700",
  }[tone];
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </p>
        <p className={cn("mt-1 font-mono text-xl font-bold", toneCls)}>
          {value}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">{sublabel}</p>
      </CardContent>
    </Card>
  );
}

function PayrollLinesTable({
  lines,
  canManage,
  isPaid,
  onEdit,
}: {
  lines: PayrollLineWithEmployee[];
  canManage: boolean;
  isPaid: boolean;
  onEdit: (l: PayrollLineWithEmployee) => void;
}) {
  const totalNet = lines.reduce((s, l) => s + l.netPay, 0);
  const totalGross = lines.reduce((s, l) => s + l.grossPay, 0);
  const totalDed = lines.reduce(
    (s, l) => s + l.lateDeduction + l.advanceDeduction + l.otherDeductions,
    0,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          {/* Group header row */}
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <th
              className="sticky left-0 z-20 bg-neutral-50 px-3 py-1.5 text-left"
              colSpan={2}
              rowSpan={2}
            >
              Karyawan
            </th>
            <th className="px-2 py-1.5" colSpan={3}>
              Attendance
            </th>
            <th
              className="border-l border-neutral-200 bg-mahakan-green-50/50 px-2 py-1.5 text-mahakan-green-900"
              colSpan={4}
            >
              Income
            </th>
            <th
              className="border-l border-neutral-200 bg-warning-50/40 px-2 py-1.5 text-warning-500"
              colSpan={3}
            >
              Deductions
            </th>
            <th
              className="border-l border-neutral-200 px-2 py-1.5"
              rowSpan={2}
            >
              Net
            </th>
            {canManage ? (
              <th className="px-2 py-1.5 text-right" rowSpan={2}>
                Aksi
              </th>
            ) : null}
          </tr>
          {/* Sub header row */}
          <tr className="text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-2 py-1.5 text-right font-medium">Hari</th>
            <th className="px-2 py-1.5 text-right font-medium">Telat</th>
            <th className="px-2 py-1.5 text-right font-medium">OT</th>
            <th className="border-l border-neutral-200 bg-mahakan-green-50/30 px-2 py-1.5 text-right font-medium">
              Base
            </th>
            <th className="bg-mahakan-green-50/30 px-2 py-1.5 text-right font-medium">
              OT
            </th>
            <th className="bg-mahakan-green-50/30 px-2 py-1.5 text-right font-medium">
              Bonus
            </th>
            <th className="bg-mahakan-green-50/30 px-2 py-1.5 text-right font-medium">
              THR
            </th>
            <th className="border-l border-neutral-200 bg-warning-50/30 px-2 py-1.5 text-right font-medium">
              Telat
            </th>
            <th className="bg-warning-50/30 px-2 py-1.5 text-right font-medium">
              Kasbon
            </th>
            <th className="bg-warning-50/30 px-2 py-1.5 text-right font-medium">
              Other
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {lines.map((l) => {
            const ptLabel =
              l.employeePaymentType === "daily"
                ? "Harian"
                : l.employeePaymentType === "monthly"
                  ? "Bulanan"
                  : "Legacy";
            const ptVariant =
              l.employeePaymentType === "daily"
                ? "info"
                : l.employeePaymentType === "monthly"
                  ? "success"
                  : "neutral";
            const formula =
              l.employeePaymentType === "daily" && l.employeeDailyRate
                ? `Rp ${l.employeeDailyRate.toLocaleString("id-ID")} × ${l.workDays} hari`
                : l.employeePaymentType === "monthly"
                  ? "Bulanan flat"
                  : "Legacy fallback";
            return (
              <tr key={l.id} className="hover:bg-neutral-50/50">
                {/* Sticky left: nama + position */}
                <td className="sticky left-0 z-10 bg-white px-3 py-2 hover:bg-neutral-50/50">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-neutral-900">
                      {l.employeeFullName}
                    </span>
                  </div>
                  {l.employeePosition ? (
                    <div className="text-[10px] text-neutral-500">
                      {l.employeePosition}
                    </div>
                  ) : null}
                </td>
                {/* Type badge col */}
                <td className="bg-white px-1 py-2">
                  <Badge variant={ptVariant}>{ptLabel}</Badge>
                </td>
                {/* Attendance group */}
                <td className="px-2 py-2 text-right font-mono">{l.workDays}</td>
                <td className="px-2 py-2 text-right font-mono text-neutral-500">
                  {l.totalLateMinutes}
                </td>
                <td className="px-2 py-2 text-right font-mono text-neutral-500">
                  {l.totalOvertimeMinutes}
                </td>
                {/* Income group */}
                <td className="border-l border-neutral-100 bg-mahakan-green-50/20 px-2 py-2 text-right font-mono">
                  <div title={formula}>{formatRupiah(l.baseSalary)}</div>
                  <div className="text-[9px] font-normal text-neutral-400">
                    {formula}
                  </div>
                </td>
                <td className="bg-mahakan-green-50/20 px-2 py-2 text-right font-mono">
                  {l.overtimePay > 0 ? (
                    formatRupiah(l.overtimePay)
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="bg-mahakan-green-50/20 px-2 py-2 text-right font-mono">
                  {l.bonus > 0 ? (
                    formatRupiah(l.bonus)
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="bg-mahakan-green-50/20 px-2 py-2 text-right font-mono">
                  {l.thr > 0 ? (
                    <span className="font-semibold text-info-500">
                      {formatRupiah(l.thr)}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                {/* Deduction group */}
                <td className="border-l border-neutral-100 bg-warning-50/20 px-2 py-2 text-right font-mono">
                  {l.lateDeduction > 0 ? (
                    <span className="text-danger-500">
                      -{formatRupiah(l.lateDeduction)}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="bg-warning-50/20 px-2 py-2 text-right font-mono">
                  {l.advanceDeduction > 0 ? (
                    <span className="text-warning-500">
                      -{formatRupiah(l.advanceDeduction)}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="bg-warning-50/20 px-2 py-2 text-right font-mono">
                  {l.otherDeductions > 0 ? (
                    <span className="text-danger-500">
                      -{formatRupiah(l.otherDeductions)}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                {/* Net */}
                <td className="border-l border-neutral-100 px-3 py-2 text-right font-mono font-bold text-neutral-900">
                  {formatRupiah(l.netPay)}
                </td>
                {canManage ? (
                  <td className="px-2 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEdit(l)}
                      disabled={isPaid}
                      aria-label={`Edit ${l.employeeFullName}`}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-neutral-200 bg-neutral-50 text-[11px] font-semibold">
          <tr>
            <td
              className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-neutral-700"
              colSpan={5}
            >
              TOTAL ({lines.length} karyawan)
            </td>
            <td
              className="border-l border-neutral-200 bg-mahakan-green-50/30 px-2 py-2 text-right font-mono text-mahakan-green-900"
              colSpan={4}
            >
              {formatRupiah(totalGross)}
            </td>
            <td
              className="border-l border-neutral-200 bg-warning-50/30 px-2 py-2 text-right font-mono text-warning-500"
              colSpan={3}
            >
              -{formatRupiah(totalDed)}
            </td>
            <td className="border-l border-neutral-200 px-3 py-2 text-right font-mono text-base font-bold text-neutral-900">
              {formatRupiah(totalNet)}
            </td>
            {canManage ? <td></td> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
