"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CircleSlash,
  HandCoins,
  Paperclip,
  Plus,
  RotateCcw,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyCard,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  createEmployeeAdvance,
  forgiveEmployeeAdvance,
  isOk,
  listEmployeeAdvanceRepayments,
  listEmployeeAdvances,
  reverseEmployeeAdvanceRepayment,
  type EmployeeAdvanceStatus,
  type EmployeeAdvanceWithEmployee,
} from "@/features/employee-advances";
import { EmployeeAdvanceRepaymentModal } from "./employee-advances/EmployeeAdvanceRepaymentModal";
import { listEmployees } from "@/features/employees";
import { isOk as employeesIsOk } from "@/features/employees";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

type StatusFilter = EmployeeAdvanceStatus | "all";

const STATUS_BADGE: Record<
  EmployeeAdvanceStatus,
  { variant: "warning" | "success" | "neutral"; label: string }
> = {
  pending: { variant: "warning", label: "Belum Lunas" },
  deducted: { variant: "success", label: "Sudah Dipotong" },
  forgiven: { variant: "neutral", label: "Di-forgive" },
  /* Sesi AE-209 — lunas lewat cicilan (setor tunai/transfer). */
  repaid: { variant: "success", label: "Lunas (Dicicil)" },
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "pending", label: "Belum Lunas" },
  { value: "repaid", label: "Lunas (Dicicil)" },
  { value: "deducted", label: "Sudah Dipotong" },
  { value: "forgiven", label: "Di-forgive" },
];

export function EmployeeAdvancesSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  /* Sesi AE-209 — kasbon yang sedang dicicil. */
  const [repayTarget, setRepayTarget] =
    useState<EmployeeAdvanceWithEmployee | null>(null);

  const { data: advances = [], isLoading } = useQuery({
    queryKey: ["admin", "employee-advances", { statusFilter }],
    queryFn: async () => {
      const res = await listEmployeeAdvances({ status: statusFilter });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const { data: repayments = [], isLoading: loadingRepayments } = useQuery({
    queryKey: ["admin", "employee-advance-repayments"],
    queryFn: async () => {
      const res = await listEmployeeAdvanceRepayments({ limit: 100 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "employee-advances"] });
    queryClient.invalidateQueries({
      queryKey: ["admin", "employee-advance-repayments"],
    });
  };

  const stats = useMemo(() => {
    /* Sesi AE-209 — kartu "Belum Lunas" pakai SISA (nominal − cicilan),
     * karena itulah yang benar-benar masih ditagih ke karyawan. */
    const pending = advances.filter((a) => a.status === "pending");
    const deducted = advances.filter((a) => a.status === "deducted");
    const forgiven = advances.filter((a) => a.status === "forgiven");
    const repaid = advances.filter((a) => a.status === "repaid");
    const sum = (rows: EmployeeAdvanceWithEmployee[]) =>
      rows.reduce((acc, r) => acc + Number(r.amount), 0);
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((acc, r) => acc + r.remainingAmount, 0),
      repaidCount: repaid.length,
      repaidAmount: sum(repaid),
      deductedCount: deducted.length,
      deductedAmount: sum(deducted),
      forgivenCount: forgiven.length,
      forgivenAmount: sum(forgiven),
    };
  }, [advances]);

  async function handleForgive(advanceId: string, employeeName: string) {
    const proceed = confirm(
      `Forgive (maafkan) kasbon ini untuk ${employeeName}? Sisa kasbonnya tidak akan dipotong dari payroll.`,
    );
    if (!proceed) return;
    const res = await forgiveEmployeeAdvance(advanceId);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Kasbon di-forgive");
    refresh();
  }

  /* Sesi AE-209 — batalkan cicilan yang salah input. Sisa kasbon naik lagi
   * dan kasbon yang tadinya lunas balik jadi belum lunas. */
  async function handleReverseRepayment(id: string, label: string) {
    const reason = window.prompt(
      `Batalkan cicilan ${label}?\nTulis alasannya (min 5 karakter) — tersimpan di Audit Log.`,
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      toast.error("Alasan minimal 5 karakter");
      return;
    }
    const res = await reverseEmployeeAdvanceRepayment({
      id,
      reason: reason.trim(),
    });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Cicilan dibatalkan, sisa kasbon dikembalikan");
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Kasbon Karyawan
          </h2>
          <p className="text-xs text-neutral-500">
            Catat kasbon (cash advance). Karyawan boleh nyicil (setor tunai
            atau transfer, bisa dilampiri bukti) — sisanya yang otomatis
            dipotong saat compute payroll periode berikutnya.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> Tambah Kasbon
        </Button>
      </header>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Belum Lunas (sisa)"
          count={stats.pendingCount}
          amount={stats.pendingAmount}
          tone="warn"
        />
        <StatCard
          icon={HandCoins}
          label="Lunas Dicicil"
          count={stats.repaidCount}
          amount={stats.repaidAmount}
          tone="success"
        />
        <StatCard
          icon={Banknote}
          label="Sudah Dipotong"
          count={stats.deductedCount}
          amount={stats.deductedAmount}
          tone="success"
        />
        <StatCard
          icon={CircleSlash}
          label="Di-forgive"
          count={stats.forgivenCount}
          amount={stats.forgivenAmount}
          tone="neutral"
        />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === f.value
                ? "bg-mahakan-green-700 text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Kasbon ({advances.length})</CardTitle>
          <CardDescription>
            Sorted by tanggal terbaru. Pending = otomatis ter-link saat
            recompute payroll.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : advances.length === 0 ? (
            <EmptyCard
              icon={Wallet}
              title="Belum ada kasbon"
              description='Klik "Tambah Kasbon" untuk catat kasbon karyawan.'
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Karyawan
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Dicicil
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Sisa</th>
                    <th className="px-3 py-2 text-left font-medium">Alasan</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Period (kalau dipotong)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((adv) => {
                    const status = STATUS_BADGE[adv.status];
                    return (
                      <tr
                        key={adv.id}
                        className="border-t border-neutral-100 hover:bg-neutral-50"
                      >
                        <td className="px-3 py-2 text-neutral-700">
                          {adv.issuedDate}
                        </td>
                        <td className="px-3 py-2 text-neutral-900">
                          {adv.employeeName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatRupiah(Number(adv.amount))}
                        </td>
                        {/* Sesi AE-209 — cicilan & sisa. */}
                        <td className="px-3 py-2 text-right font-mono text-mahakan-green-700">
                          {Number(adv.repaidAmount ?? 0) > 0 ? (
                            <>
                              {formatRupiah(Number(adv.repaidAmount ?? 0))}
                              {adv.repaymentCount > 0 ? (
                                <span className="ml-1 text-[10px] text-neutral-400">
                                  ({adv.repaymentCount}×)
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {adv.status === "pending" ? (
                            formatRupiah(adv.remainingAmount)
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">
                          {adv.reason ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="px-3 py-2 text-neutral-500">
                          {adv.deductedFromPeriodLabel ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {adv.status === "pending" ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => setRepayTarget(adv)}
                                title="Catat cicilan (setor tunai / transfer)"
                              >
                                <HandCoins className="size-3.5" /> Cicil
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleForgive(adv.id, adv.employeeName)
                                }
                              >
                                Forgive
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-neutral-400">
                              {adv.resolvedByName ?? "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sesi AE-209 — riwayat cicilan kasbon + bukti transfernya. */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Cicilan ({repayments.length})</CardTitle>
          <CardDescription>
            Setoran karyawan di luar potong gaji. Cicilan yang salah input
            bisa dibatalkan — sisa kasbonnya otomatis kembali.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRepayments ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : repayments.length === 0 ? (
            <EmptyCard
              icon={HandCoins}
              title="Belum ada cicilan"
              description='Klik "Cicil" di kasbon yang belum lunas untuk catat setoran karyawan.'
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Karyawan
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Nominal
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Cara</th>
                    <th className="px-3 py-2 text-left font-medium">Bukti</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {repayments.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-neutral-100 hover:bg-neutral-50"
                    >
                      <td className="px-3 py-2 text-neutral-700">
                        {new Date(r.occurredAt).toLocaleDateString("id-ID")}
                      </td>
                      <td className="px-3 py-2 text-neutral-900">
                        {r.employeeName}
                        <span className="ml-1 text-[10px] text-neutral-400">
                          (kasbon {formatRupiah(r.advanceAmount)})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {formatRupiah(Number(r.amount))}
                      </td>
                      <td className="px-3 py-2 text-neutral-600">
                        {r.method === "cash"
                          ? "Tunai"
                          : (r.bankLabel ?? "Transfer")}
                      </td>
                      <td className="px-3 py-2">
                        {r.receiptImageUrl ? (
                          <a
                            href={r.receiptImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-mahakan-green-700 hover:underline"
                          >
                            <Paperclip className="size-3 shrink-0" aria-hidden />
                            Lihat bukti
                          </a>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            r.status === "posted" ? "success" : "neutral"
                          }
                        >
                          {r.status === "posted" ? "Tercatat ✓" : "Dibatalkan ↺"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status === "posted" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger-600 hover:bg-danger-50"
                            title="Batalkan cicilan ini"
                            onClick={() =>
                              handleReverseRepayment(
                                r.id,
                                `${r.employeeName} ${formatRupiah(Number(r.amount))}`,
                              )
                            }
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        ) : (
                          <span className="text-[10px] text-neutral-400">
                            {r.reversalReason ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen ? (
        <CreateAdvanceModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      ) : null}

      {repayTarget ? (
        <EmployeeAdvanceRepaymentModal
          advance={repayTarget}
          onClose={() => setRepayTarget(null)}
          onSaved={() => {
            setRepayTarget(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  count,
  amount,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  count: number;
  amount: number;
  tone: "warn" | "success" | "neutral";
}) {
  const toneCls = {
    warn: "text-warning-500",
    success: "text-mahakan-green-700",
    neutral: "text-neutral-700",
  }[tone];
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-3.5" /> {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={cn("font-mono text-xl font-bold", toneCls)}>
          {count}
        </p>
        <p className="text-xs text-neutral-500">{formatRupiah(amount)}</p>
      </CardContent>
    </Card>
  );
}

function CreateAdvanceModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<
    Array<{ id: string; fullName: string; status: string }>
  >([]);
  const [employeeId, setEmployeeId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");
  const [issuedDate, setIssuedDate] = useState(
    todayJakarta(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listEmployees();
      if (cancelled) return;
      if (employeesIsOk(res)) {
        setEmployees(
          res.data.items.filter((e) => e.status === "active") as Array<{
            id: string;
            fullName: string;
            status: string;
          }>,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function tryParseAmount(): number {
    const trimmed = amountInput.trim();
    if (!trimmed) return 0;
    try {
      return parseRupiah(trimmed);
    } catch {
      return 0;
    }
  }

  async function handleSave() {
    if (submitting) return;
    setError(null);
    if (!employeeId) {
      setError("Pilih karyawan");
      return;
    }
    const amt = tryParseAmount();
    if (amt <= 0) {
      setError("Jumlah harus > 0");
      return;
    }
    setSubmitting(true);
    const res = await createEmployeeAdvance({
      employeeId,
      amount: amt,
      reason: reason.trim() || null,
      issuedDate,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`Kasbon Rp ${amt.toLocaleString("id-ID")} dicatat`);
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tambah Kasbon"
      description="Akan ke-status pending dan otomatis ter-link saat recompute payroll periode berikutnya."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSave} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Karyawan"
          value={employeeId || undefined}
          onValueChange={(v) => setEmployeeId(v ?? "")}
          placeholder="— Pilih karyawan —"
          disabled={submitting}
          options={employees.map<SelectOption>((e) => ({
            value: e.id,
            label: e.fullName,
          }))}
        />
        <Input
          label="Jumlah Kasbon (Rp)"
          type="text"
          inputMode="numeric"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value.replace(/[^\d]/g, ""))}
          disabled={submitting}
          hint={
            tryParseAmount() > 0
              ? `= ${formatRupiah(tryParseAmount())}`
              : "Mis. 200000 untuk Rp 200k"
          }
        />
        <Input
          label="Tanggal Pinjam"
          type="date"
          value={issuedDate}
          onChange={(e) => setIssuedDate(e.target.value)}
          disabled={submitting}
        />
        <Input
          label="Alasan (opsional)"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          placeholder="Mis. Bayar SPP anak"
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
