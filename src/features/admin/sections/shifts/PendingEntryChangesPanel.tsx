"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Mail,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  approveEntryChange,
  cancelEntryChange,
  isOk,
  listPendingEntryChanges,
  rejectEntryChange,
  type PendingEntryChangeWithMeta,
} from "@/features/cash";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-67 — Owner queue untuk approve/reject pending entry changes
 * (pengeluaran/pemasukan edit/delete).
 *
 * Pattern mirror PendingRebalancesPanel (sesi AE-62o):
 *  1. Tab "Pending" — semua pending requests dengan urgent badge >1h
 *  2. Click row → modal detail dengan input field code 6-digit
 *  3. Approve → status='approved' + entry ter-update / soft-delete
 *  4. Reject → status='rejected' dengan reason
 */
export function PendingEntryChangesPanel() {
  const { session } = useSession();
  const role = session?.user.role ?? "staff";
  const userId = session?.user.id ?? "";
  const canApprove = hasPermission(role, "entry_change.approve");

  const [filter, setFilter] = useState<
    "pending_approval" | "approved" | "rejected" | "cancelled" | "all"
  >("pending_approval");
  const [rows, setRows] = useState<PendingEntryChangeWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<PendingEntryChangeWithMeta | null>(null);
  const [actionMode, setActionMode] = useState<
    "approve" | "reject" | "cancel" | null
  >(null);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await listPendingEntryChanges({
        status: filter === "all" ? undefined : filter,
        limit: 50,
      });
      if (cancelled) return;
      if (isOk(res)) setRows(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey]);

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "pending_approval").length,
    [rows],
  );

  return (
    <Card>
      <CardContent className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
              <Mail className="size-5 text-mahakan-green-700" aria-hidden />
              Pending Koreksi Pengeluaran / Pemasukan
              {pendingCount > 0 ? (
                <Badge variant="warning">{pendingCount} pending</Badge>
              ) : null}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-600">
              Staff propose edit/hapus entry. Approve dengan kode 6-digit dari
              email.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[
              { v: "pending_approval" as const, l: "Pending" },
              { v: "approved" as const, l: "Approved" },
              { v: "rejected" as const, l: "Rejected" },
              { v: "cancelled" as const, l: "Cancelled" },
              { v: "all" as const, l: "Semua" },
            ].map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setFilter(f.v)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === f.v
                    ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
                )}
              >
                {f.l}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyCard
            title="Tidak ada koreksi"
            description={
              filter === "pending_approval"
                ? "Tidak ada koreksi entry yang menunggu approval."
                : "Tidak ada koreksi entry dalam filter ini."
            }
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const ageMs = nowMs - new Date(r.requestedAt).getTime();
              const isStale = r.status === "pending_approval" && ageMs > 60 * 60 * 1000;
              const orig = r.originalData as Record<string, unknown>;
              const prop = r.proposedData as Record<string, unknown> | null;
              const amount = typeof orig.amount === "number" ? orig.amount : Number(orig.amount ?? 0);
              const desc = typeof orig.description === "string" ? orig.description : "—";
              return (
                <li
                  key={r.id}
                  className={cn(
                    "rounded-lg border bg-white p-3",
                    r.status === "pending_approval"
                      ? isStale
                        ? "border-danger-300 bg-danger-50/40"
                        : "border-warning-300 bg-warning-50/40"
                      : r.status === "approved"
                        ? "border-mahakan-green-200"
                        : "border-neutral-200",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={r.operation === "delete" ? "danger" : "warning"}
                      >
                        {r.operation === "delete" ? (
                          <Trash2 className="size-3" aria-hidden />
                        ) : (
                          <Pencil className="size-3" aria-hidden />
                        )}
                        {r.operation === "delete" ? "HAPUS" : "EDIT"}{" "}
                        {r.entityType === "expense" ? "Pengeluaran" : "Pemasukan"}
                      </Badge>
                      {r.status === "pending_approval" ? (
                        <Badge variant={isStale ? "danger" : "warning"}>
                          <Clock className="size-3" aria-hidden />
                          {isStale ? "Stale >1h" : "Pending"}
                        </Badge>
                      ) : r.status === "approved" ? (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3" aria-hidden /> Approved
                        </Badge>
                      ) : r.status === "rejected" ? (
                        <Badge variant="danger">
                          <XCircle className="size-3" aria-hidden /> Rejected
                        </Badge>
                      ) : (
                        <Badge variant="neutral">{r.status}</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-neutral-500">
                      {formatIndonesianDateTime(r.requestedAt)}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-neutral-900">
                    <span className="font-mono">
                      Rp {formatRupiah(amount)}
                    </span>{" "}
                    — {desc}
                  </p>

                  {r.operation === "update" && prop ? (
                    <div className="mt-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-[11px]">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                        Perubahan
                      </p>
                      <ul className="space-y-0.5">
                        {Object.entries(prop).map(([k, v]) => {
                          if (v == null) return null;
                          const label =
                            k === "amount"
                              ? "Nominal"
                              : k === "description"
                                ? "Deskripsi"
                                : k === "expenseDate" || k === "incomeDate"
                                  ? "Tanggal"
                                  : k === "paymentMethod"
                                    ? "Metode"
                                    : k === "categoryId"
                                      ? "Kategori"
                                      : k;
                          const formatted =
                            typeof v === "number" && k === "amount"
                              ? `Rp ${formatRupiah(v)}`
                              : String(v);
                          return (
                            <li key={k} className="flex gap-2">
                              <span className="text-neutral-500">{label}:</span>
                              <span className="font-mono font-medium text-neutral-900">
                                {formatted}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <p className="mt-2 text-[11px] italic text-neutral-600">
                    “{r.reason}” — {r.requestedByName ?? "Staff"}
                  </p>

                  {r.status === "rejected" && r.rejectedReason ? (
                    <p className="mt-1 text-[11px] text-danger-500">
                      Reject: {r.rejectedReason}
                    </p>
                  ) : null}

                  {(() => {
                    if (r.status !== "pending_approval") return null;
                    /* Sesi AE-150 — entity-level role distinction.
                     * Submitter (yang propose koreksi) → "Input Kode" + Cancel.
                     * Non-submitter approver → "Reject" saja.
                     * Owner approve via email channel (out-of-band). */
                    const isSubmitter = r.requestedBy === userId;
                    return (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {isSubmitter && canApprove ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setActionTarget(r);
                                setActionMode("approve");
                              }}
                            >
                              <KeyRound className="size-4" /> Input Kode
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setActionTarget(r);
                                setActionMode("cancel");
                              }}
                              className="text-warning-700 hover:bg-warning-100"
                            >
                              <Ban className="size-4" /> Cancel
                            </Button>
                            <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-info-700">
                              <Mail className="size-3" /> Pengajuan Anda
                            </span>
                          </>
                        ) : !isSubmitter && canApprove ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActionTarget(r);
                              setActionMode("reject");
                            }}
                            className="text-danger-500 hover:bg-danger-100"
                          >
                            <XCircle className="size-4" /> Reject
                          </Button>
                        ) : null}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* Action modal (approve/reject) */}
      <ActionModal
        target={actionTarget}
        mode={actionMode}
        onClose={() => {
          setActionTarget(null);
          setActionMode(null);
        }}
        onSubmitted={() => {
          setActionTarget(null);
          setActionMode(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </Card>
  );
}

function ActionModal({
  target,
  mode,
  onClose,
  onSubmitted,
}: {
  target: PendingEntryChangeWithMeta | null;
  mode: "approve" | "reject" | "cancel" | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [code, setCode] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setCode("");
      setRejectReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [target]);

  if (!target || !mode) return null;

  async function onSubmit() {
    if (!target || !mode) return;
    setError(null);
    setSubmitting(true);

    if (mode === "approve") {
      if (!/^\d{6}$/.test(code.trim())) {
        setError("Kode harus 6 digit angka");
        setSubmitting(false);
        return;
      }
      const res = await approveEntryChange({
        changeId: target.id,
        code: code.trim(),
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success("Koreksi disetujui — entry sudah ter-update");
      onSubmitted();
    } else if (mode === "reject") {
      if (rejectReason.trim().length < 3) {
        setError("Alasan reject minimal 3 karakter");
        setSubmitting(false);
        return;
      }
      const res = await rejectEntryChange({
        changeId: target.id,
        reason: rejectReason.trim(),
      });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success("Koreksi ditolak");
      onSubmitted();
    } else if (mode === "cancel") {
      const res = await cancelEntryChange({ changeId: target.id });
      setSubmitting(false);
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.info("Pengajuan dibatalkan");
      onSubmitted();
    }
  }

  const titleMap = {
    approve: "Input Kode Approval",
    reject: "Reject Koreksi Entry",
    cancel: "Cancel Pengajuan Anda",
  } as const;

  return (
    <Modal
      open={!!target && !!mode}
      onClose={submitting ? () => undefined : onClose}
      title={titleMap[mode]}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting}
            size="lg"
            variant={
              mode === "approve"
                ? "primary"
                : mode === "reject"
                  ? "destructive"
                  : "outline"
            }
          >
            {mode === "approve" ? (
              <>
                <KeyRound className="size-4" /> Apply
              </>
            ) : mode === "reject" ? (
              <>
                <XCircle className="size-4" /> Reject
              </>
            ) : (
              <>
                <Ban className="size-4" /> Cancel
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
          <p>
            <strong>{target.operation === "delete" ? "HAPUS" : "EDIT"}</strong>{" "}
            {target.entityType === "expense" ? "Pengeluaran" : "Pemasukan"} —{" "}
            <span className="font-mono">
              Rp{" "}
              {formatRupiah(
                Number(
                  (target.originalData as Record<string, unknown>).amount ?? 0,
                ),
              )}
            </span>
          </p>
          <p className="mt-1 italic text-neutral-600">
            “{target.reason}” — {target.requestedByName ?? "Staff"}
          </p>
        </div>

        {mode === "approve" ? (
          <>
            <p className="text-xs text-neutral-700">
              Owner kirim kode 6-digit via WA / SMS setelah review email.
              Masukkan kode untuk apply koreksi ini.
            </p>
            <Input
              label="Kode 6-digit"
              placeholder="000000"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
              }
              inputMode="numeric"
              maxLength={6}
              required
              autoFocus
            />
          </>
        ) : mode === "reject" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="reject-reason"
              className="text-xs font-semibold uppercase tracking-wider text-neutral-700"
            >
              Alasan Reject{" "}
              <span className="text-danger-500" aria-hidden>
                *
              </span>
            </label>
            <textarea
              id="reject-reason"
              rows={2}
              placeholder="mis. nominal sudah benar, jangan diubah"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
              required
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-700">
              Yakin batalkan pengajuan ini? Kode 6-digit yang sudah dikirim ke
              Owner akan di-revoke.
            </p>
            <p className="rounded-md bg-warning-50 px-2 py-1.5 text-[11px] text-warning-700">
              Submit ulang dengan nilai benar kalau perlu.
            </p>
          </>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-300 bg-danger-100 p-2 text-sm font-medium text-danger-700"
          >
            <AlertTriangle className="mr-1 inline size-4" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
