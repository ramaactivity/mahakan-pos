"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Download,
  History,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  cancelOpname,
  getActiveOpname,
  getMonthlyCadence,
  getOpnameDetail,
  isOk,
  jakartaMonthLabel,
  listOpnameSessions,
  startOpname,
  type MonthlyCadenceStatus,
  type OpnameSessionDetail,
  type OpnameSessionWithCounts,
  type OpnameStatus,
} from "@/features/stock-opname";
import { useSession } from "@/features/auth/SessionProvider";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { OpnameCountView } from "./OpnameCountView";
import { OpnameReviewView } from "./OpnameReviewView";
import { downloadOpnameResult } from "./opname-csv";

const STATUS_LABELS: Record<OpnameStatus, string> = {
  in_progress: "Berjalan",
  pending_review: "Menunggu review",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_TONES: Record<
  OpnameStatus,
  "info" | "warning" | "success" | "neutral"
> = {
  in_progress: "info",
  pending_review: "warning",
  completed: "success",
  cancelled: "neutral",
};

export function OpnameTab() {
  const { session } = useSession();
  const role = session?.user.role ?? "staff";
  const canStart = hasPermission(role, "inventory.opname.start");
  const canCancel = hasPermission(role, "inventory.opname.cancel");

  const [activeDetail, setActiveDetail] =
    useState<OpnameSessionDetail | null>(null);
  const [history, setHistory] = useState<OpnameSessionWithCounts[]>([]);
  const [cadence, setCadence] = useState<MonthlyCadenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Tracks whether the very first fetch has completed. Only the initial fetch
  // shows skeleton; subsequent refresh-key bumps refetch silently so the
  // OpnameCountView does not unmount mid-typing. (Was: every refresh bumped
  // setLoading(true) → Skeleton → unmount → child useState re-init → lost
  // mid-debounce input from other cells. Reported by Owner sesi Z #1.)
  const hasLoadedOnce = useRef(false);

  const [historyDetail, setHistoryDetail] =
    useState<OpnameSessionDetail | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [startOpen, setStartOpen] = useState(false);
  const [startNotes, setStartNotes] = useState("");
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasLoadedOnce.current) setLoading(true);
      const [activeRes, listRes, cadenceRes] = await Promise.all([
        getActiveOpname(),
        listOpnameSessions({ limit: 30 }),
        getMonthlyCadence(),
      ]);
      if (cancelled) return;

      if (isOk(activeRes) && activeRes.data) {
        const detail = await getOpnameDetail(activeRes.data.id);
        if (!cancelled && isOk(detail) && detail.data) {
          setActiveDetail(detail.data);
        } else if (!cancelled) {
          setActiveDetail(null);
        }
      } else {
        setActiveDetail(null);
      }
      if (isOk(listRes)) setHistory(listRes.data);
      if (isOk(cadenceRes)) setCadence(cadenceRes.data);
      setLoading(false);
      hasLoadedOnce.current = true;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  /* Sesi AE-176 — sinkron antar owner: refresh saat balik ke tab (silent,
   * tak hapus input karena hasLoadedOnce guard). Tanpa polling latar supaya
   * tidak refetch saat staff sedang mengetik hitungan. */
  useLiveRefresh(refresh);

  async function onStart() {
    if (startSubmitting) return;
    setStartSubmitting(true);
    setStartError(null);
    const res = await startOpname({
      periodLabel: jakartaMonthLabel(new Date()),
      notes: startNotes.trim() || null,
    });
    setStartSubmitting(false);
    if (!isOk(res)) {
      setStartError(res.error.message);
      return;
    }
    toast.success(
      `Opname ${res.data.periodLabel} dimulai (${res.data.totalLines} bahan)`,
    );
    setStartOpen(false);
    setStartNotes("");
    setActiveDetail(res.data);
    refresh();
  }

  async function onConfirmCancel() {
    if (!cancelTargetId || cancelSubmitting) return;
    if (cancelReason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setCancelSubmitting(true);
    const res = await cancelOpname({
      sessionId: cancelTargetId,
      reason: cancelReason.trim(),
    });
    setCancelSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Sesi opname dibatalkan");
    setCancelTargetId(null);
    setCancelReason("");
    refresh();
  }

  async function openHistoryDetail(sessionId: string) {
    setHistoryLoading(true);
    const res = await getOpnameDetail(sessionId);
    setHistoryLoading(false);
    if (!isOk(res) || !res.data) {
      toast.error("Gagal load detail sesi");
      return;
    }
    setHistoryDetail(res.data);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Render: active session (count or review) takes precedence over history list.
  return (
    <div className="space-y-4">
      {!activeDetail && cadence ? (
        <Card
          className={
            cadence.hasCompletedThisMonth
              ? "border-mahakan-green-700/30 bg-mahakan-green-100/20"
              : "border-warning-500/40 bg-warning-100/30"
          }
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                {cadence.hasCompletedThisMonth
                  ? `Opname ${cadence.currentMonthLabel} sudah dilakukan ✓`
                  : `Opname ${cadence.currentMonthLabel} belum dilakukan`}
              </p>
              <p className="text-xs text-neutral-600">
                {cadence.lastCompletedAt
                  ? `Terakhir: ${cadence.lastCompletedPeriodLabel} — ${new Date(
                      cadence.lastCompletedAt,
                    ).toLocaleDateString("id-ID", {
                      dateStyle: "medium",
                    })}`
                  : "Belum ada opname yang pernah selesai. Mulai sekarang biar stok aktual cocok dengan sistem."}
              </p>
            </div>
            {canStart ? (
              <Button onClick={() => setStartOpen(true)}>
                <CalendarPlus className="size-4" aria-hidden /> Mulai Opname
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeDetail?.status === "in_progress" ? (
        <OpnameCountView
          detail={activeDetail}
          role={role}
          onCancel={() => setCancelTargetId(activeDetail.id)}
          onChanged={refresh}
          onSubmittedForReview={refresh}
        />
      ) : null}

      {activeDetail?.status === "pending_review" ? (
        <OpnameReviewView
          detail={activeDetail}
          role={role}
          onCancel={() => setCancelTargetId(activeDetail.id)}
          onFinalized={refresh}
          onReopened={refresh}
        />
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <History className="size-4" aria-hidden /> Riwayat Opname
          </h3>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {history.length === 0 ? (
            <EmptyCard
              icon={History}
              title="Belum ada riwayat opname"
              description="Klik “Mulai Opname Baru” di atas untuk session pertama."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">
                      Periode
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      Mulai
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Bahan
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Δ Cost (abs)
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-900">
                          {h.periodLabel}
                        </p>
                        {h.notes ? (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {h.notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONES[h.status]}>
                          {STATUS_LABELS[h.status]}
                        </Badge>
                        {h.status === "cancelled" && h.cancelReason ? (
                          <p className="mt-0.5 text-[11px] text-neutral-500">
                            {h.cancelReason}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {new Date(h.startedAt).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        <p className="text-[11px] text-neutral-500">
                          oleh {h.startedByName ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {h.countedLines}/{h.totalLines}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {h.status === "completed" ||
                        h.status === "pending_review"
                          ? formatRupiah(h.totalDiffCost)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openHistoryDetail(h.id)}
                        >
                          <ClipboardList
                            className="size-4"
                            aria-hidden
                          />{" "}
                          Detail
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={startOpen}
        onClose={() => {
          setStartOpen(false);
          setStartError(null);
        }}
        title={`Mulai opname ${jakartaMonthLabel(new Date())}?`}
        description="Sistem akan menyimpan stok saat ini sebagai expected qty. Lalu kamu input qty aktual setelah hitung fisik. Bisa di-pause + lanjutkan kapan aja."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setStartOpen(false)}
              disabled={startSubmitting}
            >
              Batal
            </Button>
            <Button onClick={onStart} loading={startSubmitting}>
              <CheckCircle2 className="size-4" aria-hidden /> Mulai
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Catatan (opsional)
            </label>
            <textarea
              rows={2}
              value={startNotes}
              onChange={(e) => setStartNotes(e.target.value)}
              placeholder="mis. Opname akhir bulan, dilakukan tim malam"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
            />
          </div>
          <p className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            <strong>Tip:</strong> Klik &ldquo;Lembar Hitung (CSV)&rdquo;
            setelah mulai untuk download lembar yang bisa di-print + bawa
            keliling gudang.
          </p>
          {startError ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {startError}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={cancelTargetId !== null}
        onClose={() => {
          setCancelTargetId(null);
          setCancelReason("");
        }}
        title="Cancel sesi opname?"
        description="Sesi akan di-mark sebagai dibatalkan. Tidak ada perubahan stok. Snapshot lines tetap disimpan untuk audit."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCancelTargetId(null);
                setCancelReason("");
              }}
              disabled={cancelSubmitting}
            >
              Tutup
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmCancel}
              loading={cancelSubmitting}
            >
              Ya, batalkan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="Alasan batal"
            placeholder="mis. salah mulai, ulang dengan tim shift pagi"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      </Modal>

      <HistoryDetailModal
        detail={historyDetail}
        loading={historyLoading}
        onClose={() => setHistoryDetail(null)}
        canCancel={
          canCancel &&
          (historyDetail?.status === "in_progress" ||
            historyDetail?.status === "pending_review")
        }
        onCancel={(id) => {
          setHistoryDetail(null);
          setCancelTargetId(id);
        }}
      />
    </div>
  );
}

interface HistoryDetailModalProps {
  detail: OpnameSessionDetail | null;
  loading: boolean;
  onClose: () => void;
  canCancel: boolean;
  onCancel: (id: string) => void;
}

function HistoryDetailModal({
  detail,
  loading,
  onClose,
  canCancel,
  onCancel,
}: HistoryDetailModalProps) {
  if (!detail) return null;
  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      title={`Detail Opname — ${detail.periodLabel}`}
      description={`Status: ${STATUS_LABELS[detail.status]}`}
      size="lg"
      footer={
        <>
          {canCancel ? (
            <Button
              variant="outline"
              className="text-danger-500 hover:bg-danger-100"
              onClick={() => onCancel(detail.id)}
            >
              Cancel sesi
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() =>
              downloadOpnameResult(detail.periodLabel, detail.lines)
            }
          >
            <Download className="size-4" aria-hidden /> Hasil (CSV)
          </Button>
          <Button onClick={onClose}>Tutup</Button>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Info label="Mulai" value={detail.startedByName ?? "—"} />
            <Info
              label="Submit"
              value={detail.submittedByName ?? "—"}
            />
            <Info
              label="Finalize"
              value={detail.finalizedByName ?? "—"}
            />
            <Info
              label="Cancel"
              value={detail.cancelledByName ?? "—"}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Info
              label="Bahan"
              value={`${detail.countedLines}/${detail.totalLines}`}
            />
            <Info
              label="Δ Qty (abs)"
              value={detail.totalDiffQty.toLocaleString("id-ID")}
            />
            <Info
              label="Δ Cost (abs)"
              value={formatRupiah(detail.totalDiffCost)}
            />
            <Info
              label="Mulai"
              value={new Date(detail.startedAt).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            />
          </div>
          {detail.notes ? (
            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              <strong>Catatan:</strong> {detail.notes}
            </p>
          ) : null}
          {detail.cancelReason ? (
            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              <strong>Alasan batal:</strong> {detail.cancelReason}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="font-medium text-neutral-900">{value}</p>
    </div>
  );
}

