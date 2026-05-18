"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail, RefreshCw, Send, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Select,
  Skeleton,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  isOk,
  listPayrollPeriods,
  listPayslipEmailsForPeriod,
  resendPayslipForLine,
  resendPayslipsForPeriod,
} from "@/features/payroll";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";

const STATUS_LABEL: Record<
  string,
  { variant: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  sent: { variant: "success", label: "Terkirim" },
  logged: { variant: "neutral", label: "Logged (dev)" },
  failed: { variant: "danger", label: "Gagal" },
};

export function SlipGajiSection() {
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [resendingLineId, setResendingLineId] = useState<string | null>(null);
  const [resendingPeriod, setResendingPeriod] = useState(false);

  const periodsQuery = useQuery({
    queryKey: ["payroll-periods-paid"],
    queryFn: async () => {
      const res = await listPayrollPeriods();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  /* Auto-pick first paid period kalau belum ada selection. */
  const paidPeriods = useMemo(
    () =>
      (periodsQuery.data ?? []).filter((p) => p.status === "paid"),
    [periodsQuery.data],
  );

  const effectivePeriodId = useMemo(() => {
    if (selectedPeriodId) return selectedPeriodId;
    return paidPeriods[0]?.id ?? null;
  }, [selectedPeriodId, paidPeriods]);

  const payslipsQuery = useQuery({
    queryKey: ["payslip-emails", effectivePeriodId],
    enabled: Boolean(effectivePeriodId),
    queryFn: async () => {
      if (!effectivePeriodId) return [];
      const res = await listPayslipEmailsForPeriod(effectivePeriodId);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const periodOptions: SelectOption[] = paidPeriods.map((p) => ({
    value: p.id,
    label: `${p.label} — Dibayar ${formatIndonesianDateTime(p.paidAt ?? p.updatedAt)}`,
  }));

  const summary = useMemo(() => {
    const rows = payslipsQuery.data ?? [];
    const sent = rows.filter((r) => r.latestStatus === "sent").length;
    const failed = rows.filter((r) => r.latestStatus === "failed").length;
    const noEmail = rows.filter((r) => !r.employeeEmail).length;
    const notSent = rows.filter((r) => r.latestStatus === null).length;
    return { total: rows.length, sent, failed, noEmail, notSent };
  }, [payslipsQuery.data]);

  async function handleResendLine(lineId: string, employeeName: string) {
    setResendingLineId(lineId);
    try {
      const res = await resendPayslipForLine(lineId);
      if (!isOk(res)) {
        toast.error(`Gagal kirim ${employeeName}: ${res.error.message}`);
        return;
      }
      if (res.data.status === "sent") {
        toast.success(`${employeeName}: ${res.data.message}`);
      } else {
        toast.error(`${employeeName}: ${res.data.message}`);
      }
      queryClient.invalidateQueries({
        queryKey: ["payslip-emails", effectivePeriodId],
      });
    } finally {
      setResendingLineId(null);
    }
  }

  async function handleResendAll() {
    if (!effectivePeriodId) return;
    if (
      !window.confirm("Kirim ulang slip gaji ke SEMUA karyawan di periode ini?")
    ) {
      return;
    }
    setResendingPeriod(true);
    try {
      const res = await resendPayslipsForPeriod(effectivePeriodId);
      if (!isOk(res)) {
        toast.error(`Gagal kirim: ${res.error.message}`);
        return;
      }
      const s = res.data;
      const msg = `${s.sent} terkirim, ${s.failed} gagal, ${s.skippedNoEmail} tanpa email, ${s.logged} logged`;
      if (s.failed > 0 || s.skippedNoEmail > 0) {
        toast.error(`Kirim selesai dengan masalah: ${msg}`);
      } else {
        toast.success(`Kirim ulang selesai: ${msg}`);
      }
      queryClient.invalidateQueries({
        queryKey: ["payslip-emails", effectivePeriodId],
      });
    } finally {
      setResendingPeriod(false);
    }
  }

  return (
    <div className="space-y-4 px-6 py-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-mahakan-green-700" />
              Slip Gaji — Email Karyawan
            </CardTitle>
            <p className="mt-1 text-sm text-neutral-600">
              History pengiriman slip gaji ke email karyawan. Auto-kirim
              terjadi saat Owner mark periode &quot;paid&quot;. Owner bisa kirim
              ulang per karyawan kalau email gagal / karyawan minta.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => handleResendAll()}
            disabled={!effectivePeriodId || resendingPeriod || summary.total === 0}
          >
            <Send className="mr-2 h-4 w-4" />
            {resendingPeriod ? "Mengirim…" : "Kirim Ulang Semua"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Periode (hanya yang sudah dibayar)
              </label>
              <Select
                value={effectivePeriodId ?? undefined}
                onValueChange={(v) => setSelectedPeriodId(v ?? null)}
                options={periodOptions}
                placeholder="Pilih periode…"
                disabled={periodsQuery.isLoading || periodOptions.length === 0}
              />
            </div>
          </div>

          {periodsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : periodOptions.length === 0 ? (
            <EmptyCard
              title="Belum ada periode yang sudah dibayar"
              description="Slip gaji baru bisa dikirim setelah Owner mark periode payroll status &quot;paid&quot;."
            />
          ) : payslipsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral">Total: {summary.total}</Badge>
                <Badge variant="success">Terkirim: {summary.sent}</Badge>
                {summary.failed > 0 && (
                  <Badge variant="danger">Gagal: {summary.failed}</Badge>
                )}
                {summary.noEmail > 0 && (
                  <Badge variant="warning">Tanpa email: {summary.noEmail}</Badge>
                )}
                {summary.notSent > 0 && (
                  <Badge variant="warning">Belum dikirim: {summary.notSent}</Badge>
                )}
              </div>

              {/* List */}
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">Karyawan</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 text-right font-medium">Net Pay</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Terakhir Kirim</th>
                      <th className="px-3 py-2 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {(payslipsQuery.data ?? []).map((row) => {
                      const status = row.latestStatus
                        ? STATUS_LABEL[row.latestStatus]
                        : null;
                      const isResending = resendingLineId === row.lineId;
                      return (
                        <tr key={row.lineId}>
                          <td className="px-3 py-2 font-medium text-neutral-900">
                            {row.employeeName}
                          </td>
                          <td className="px-3 py-2 text-neutral-700">
                            {row.employeeEmail ? (
                              row.employeeEmail
                            ) : (
                              <span className="text-amber-600">
                                Belum di-set
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatRupiah(row.netPay)}
                          </td>
                          <td className="px-3 py-2">
                            {status ? (
                              <div className="flex items-center gap-1.5">
                                {row.latestStatus === "sent" ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                ) : row.latestStatus === "failed" ? (
                                  <XCircle className="h-4 w-4 text-red-600" />
                                ) : null}
                                <Badge variant={status.variant}>{status.label}</Badge>
                                {row.latestErrorCode && (
                                  <span className="text-xs text-neutral-500">
                                    ({row.latestErrorCode})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge variant="warning">Belum dikirim</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-neutral-600">
                            {row.latestSentAt ? (
                              <>
                                {formatIndonesianDateTime(row.latestSentAt)}
                                {row.attempts > 1 && (
                                  <span className="ml-1 text-xs text-neutral-500">
                                    ({row.attempts}×)
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleResendLine(row.lineId, row.employeeName)
                              }
                              disabled={isResending}
                            >
                              <RefreshCw
                                className={`mr-1 h-3.5 w-3.5 ${isResending ? "animate-spin" : ""}`}
                              />
                              {isResending ? "Mengirim…" : "Kirim"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
