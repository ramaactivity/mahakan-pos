"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  abandonJournalQueueRow,
  getJournalQueuePendingCount,
  listJournalQueue,
  retryJournalQueueRow,
  sweepJournalGapsAction,
} from "@/features/accounting/retry-queue";
import type { JournalRetryQueueListRow } from "@/features/accounting/retry-queue-types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "pending" | "resolved" | "abandoned" | "all";

/**
 * Feedback owner 2026-06-12 — terjemahkan error teknis ke bahasa manusia
 * supaya finance/accounting/inventory paham apa yang terjadi + apa yang
 * perlu dicek sebelum klik Retry. Pattern-match error umum; fallback null
 * (UI tampilkan saran generik).
 */
function explainError(lastError: string): {
  explanation: string;
  safeToRetry: boolean;
} | null {
  const e = lastError.toLowerCase();
  if (
    /connection terminated|connection refused|econnreset|etimedout|timeout|fetch failed|socket hang up|terminating connection/.test(
      e,
    )
  ) {
    return {
      explanation:
        "Koneksi ke database terputus sesaat (gangguan jaringan/server, bukan salah input). Transaksi aslinya aman tersimpan — jurnalnya saja yang belum tercatat. Biasanya langsung berhasil saat di-Retry.",
      safeToRetry: true,
    };
  }
  if (/invalid input syntax|22p02|numeric field overflow/.test(e)) {
    return {
      explanation:
        "Ada nilai yang formatnya tidak cocok dengan pembukuan (mis. angka desimal masuk ke kolom angka bulat). Retry kemungkinan gagal lagi dengan error yang sama. Cek dulu nilai transaksi di Detail Transaksi — kalau Retry tetap gagal, catat manual via Akuntansi → Jurnal Manual lalu Abandon antrian ini.",
      safeToRetry: false,
    };
  }
  if (/duplicate key|unique constraint|already exists/.test(e)) {
    return {
      explanation:
        "Jurnal ini kemungkinan sebenarnya sudah ter-post (sistem mencegah pencatatan dobel). Aman di-Retry — kalau jurnalnya memang sudah ada, sistem pakai yang sudah ada tanpa mencatat dobel.",
      safeToRetry: true,
    };
  }
  if (/foreign key|violates not-null|constraint/.test(e)) {
    return {
      explanation:
        "Ada data rujukan yang tidak lengkap/tidak valid saat pencatatan jurnal. Cek dulu Detail Transaksi — kalau Retry tetap gagal, catat manual via Akuntansi → Jurnal Manual lalu Abandon antrian ini.",
      safeToRetry: false,
    };
  }
  return null;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Selesai" },
  { key: "abandoned", label: "Diabaikan" },
  { key: "all", label: "Semua" },
];

/**
 * Sesi AE-62w — owner-facing UI untuk antrian retry journal hook.
 *
 * Workflow owner:
 *   1. Buka tab → lihat list pending failures
 *   2. Tap "Retry" → re-invoke hook dengan stored args; sukses = resolved
 *   3. Atau tap "Abandon" → owner sudah manual fix di Akuntansi → Jurnal,
 *      mark row sebagai diabaikan dengan alasan.
 *
 * Stats card di atas: count pending = urgency indicator. Klik refresh
 * untuk re-poll. List re-fetched setiap mutation.
 */
export function JournalRetryQueueSection() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [abandonTarget, setAbandonTarget] =
    useState<JournalRetryQueueListRow | null>(null);
  const [abandonReason, setAbandonReason] = useState("");
  const [abandonSubmitting, setAbandonSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const listQuery = useQuery({
    queryKey: ["admin", "journal-retry-queue", { status: tab }],
    queryFn: async () => {
      const res = await listJournalQueue({ status: tab });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 15 * 1000,
  });

  const countQuery = useQuery({
    queryKey: ["admin", "journal-retry-queue", "count"],
    queryFn: async () => {
      const res = await getJournalQueuePendingCount();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const rows = listQuery.data ?? [];
  const pendingCount = countQuery.data?.pending ?? 0;

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "journal-retry-queue"],
    });
  }

  async function onRetry(row: JournalRetryQueueListRow) {
    setRetryingId(row.id);
    const res = await retryJournalQueueRow({ id: row.id });
    setRetryingId(null);
    if (!res.ok) {
      toast.error(res.error.message);
      refresh();
      return;
    }
    toast.success(
      `✓ Retry sukses (attempt ${res.data.retryCount}) — journal ${res.data.journalEntryId?.slice(0, 8) ?? "?"} ter-post`,
    );
    refresh();
  }

  /* Sesi AE-182 — jalankan sapuan sekarang: retry antrian + cari transaksi
   * dan pengeluaran 30 hari terakhir yang jurnalnya belum tercatat. */
  async function onSweep() {
    setSweeping(true);
    const res = await sweepJournalGapsAction({ lookbackDays: 30 });
    setSweeping(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    const d = res.data;
    if (d.fixed === 0 && d.failed === 0) {
      toast.info("Tidak ada jurnal kosong — semua sudah tercatat.");
    } else {
      toast.success(
        `✓ ${d.fixed} jurnal dipulihkan (${d.salesPosted} penjualan, ${d.voidsPosted} void, ${d.expensesPosted} pengeluaran, ${d.queueResolved} dari antrian)` +
          (d.failed > 0 ? ` — ${d.failed} masih gagal.` : ""),
      );
    }
    refresh();
  }

  async function onAbandon() {
    if (!abandonTarget) return;
    const reason = abandonReason.trim();
    if (reason.length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setAbandonSubmitting(true);
    const res = await abandonJournalQueueRow({
      id: abandonTarget.id,
      reason,
    });
    setAbandonSubmitting(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.info("Antrian di-abandon");
    setAbandonTarget(null);
    setAbandonReason("");
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <AlertTriangle className="size-6" aria-hidden /> Antrian Jurnal
            Gagal
          </h1>
          <p className="text-sm text-neutral-700 max-w-2xl">
            Snapshot dari journal hook yang gagal post (transient DB error,
            schema bug, atau race). Owner re-trigger di sini. Source action
            (sale/refund/expense/dll) sudah committed — antrian ini hanya
            re-run journal posting yang missed. Idempotent via UNIQUE
            constraint di journal_entries (AE-62t) — aman kalau di-retry 2x.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sesi AE-182 — sapuan manual. Versi otomatisnya jalan tiap jam
              lewat cron; tombol ini untuk owner yang mau langsung. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onSweep}
            disabled={sweeping}
            aria-label="Sapu jurnal kosong"
          >
            <Sparkles className={cn("size-4", sweeping && "animate-pulse")} />
            {sweeping ? "Menyapu…" : "Sapu Jurnal Kosong"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="border-mahakan-green-200 bg-mahakan-green-50/50 p-4 text-sm text-neutral-700">
        <p>
          <strong>Jurnal dipulihkan otomatis.</strong> Setiap jam sistem
          memeriksa transaksi & pengeluaran 7 hari terakhir yang jurnalnya
          belum tercatat, lalu mencatatnya sendiri — termasuk antrian di bawah
          ini. Tombol <em>Sapu Jurnal Kosong</em> menjalankan pemeriksaan yang
          sama sekarang juga, mundur 30 hari.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          Icon={AlertTriangle}
          label="Pending"
          value={String(pendingCount)}
          accent={pendingCount > 0 ? "danger" : "default"}
          sub={
            pendingCount > 0
              ? "Klik tab Pending → tap Retry untuk re-post"
              : "Semua journal ter-post"
          }
        />
        <StatCard
          Icon={CheckCircle2}
          label="Total Resolved"
          value={String(
            rows.filter((r) => r.resolvedAt !== null).length,
          )}
          accent="success"
          sub="Berhasil di-retry / auto-resolved"
        />
        <StatCard
          Icon={XCircle}
          label="Abandoned"
          value={String(
            rows.filter((r) => r.abandonedAt !== null).length,
          )}
          accent="default"
          sub="Owner mark manual-fixed"
        />
      </div>

      <div
        role="tablist"
        aria-label="Filter status"
        className="flex flex-wrap gap-1 border-b border-neutral-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              tab === t.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <Card className="p-6 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : listQuery.isError ? (
        /* Sesi AE-76 — surface error supaya tidak silent blank list.
         * Mismatch pending=3 tapi list=[] hampir pasti query gagal di server. */
        <Card className="p-6 space-y-3 border-danger-300 bg-danger-50/40">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="size-5 shrink-0 text-danger-500 mt-0.5"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-danger-700">
                Gagal memuat antrian
              </h3>
              <p className="mt-1 text-xs text-danger-700">
                {listQuery.error instanceof Error
                  ? listQuery.error.message
                  : String(listQuery.error)}
              </p>
              <Button
                variant="outline"
                onClick={refresh}
                className="mt-3"
              >
                <RefreshCw className="size-4" aria-hidden /> Coba lagi
              </Button>
            </div>
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyCard
          icon={CheckCircle2}
          title={
            tab === "pending"
              ? "Tidak ada antrian pending"
              : "Belum ada catatan untuk filter ini"
          }
          description={
            tab === "pending"
              ? "Semua journal hook sukses ter-post. Kalau ada failure baru, akan muncul di sini otomatis."
              : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <QueueRowCard
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === row.id ? null : row.id)
              }
              onRetry={() => onRetry(row)}
              onAbandon={() => setAbandonTarget(row)}
              retrying={retryingId === row.id}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!abandonTarget}
        onClose={() => setAbandonTarget(null)}
        title="Abandon Antrian Retry"
        description={
          abandonTarget
            ? `${abandonTarget.hookDisplayName}${abandonTarget.sourceSummary ? ` — ${abandonTarget.sourceSummary}` : ""} · error: ${abandonTarget.lastError.slice(0, 80)}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setAbandonTarget(null)}
              disabled={abandonSubmitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onAbandon}
              disabled={
                abandonSubmitting || abandonReason.trim().length < 3
              }
              loading={abandonSubmitting}
            >
              Abandon
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-600">
            Mark antrian ini sebagai diabaikan — owner sudah manual fix di
            Akuntansi → Jurnal Manual, atau journal entry ini memang tidak
            perlu di-post. Setelah abandon, row tidak akan muncul lagi di
            tab Pending.
          </p>
          <Input
            label="Alasan abandon"
            value={abandonReason}
            onChange={(e) => setAbandonReason(e.target.value)}
            placeholder="Mis. sudah di-input manual di Jurnal"
            hint="Minimal 3 karakter — tercatat di audit log."
          />
        </div>
      </Modal>
    </div>
  );
}

function StatCard({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof AlertTriangle;
  label: string;
  value: string;
  sub?: string;
  accent?: "default" | "danger" | "success";
}) {
  const accentClass =
    accent === "danger"
      ? "border-danger-300 bg-danger-50"
      : accent === "success"
        ? "border-mahakan-green-200 bg-mahakan-green-50/40"
        : "border-neutral-200 bg-white";
  return (
    <Card className={cn("p-4", accentClass)}>
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "size-5 mt-0.5 shrink-0",
            accent === "danger"
              ? "text-danger-500"
              : accent === "success"
                ? "text-mahakan-green-700"
                : "text-neutral-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            {label}
          </p>
          <p className="text-2xl font-bold text-neutral-900 font-mono">
            {value}
          </p>
          {sub ? (
            <p className="mt-0.5 text-[11px] text-neutral-600">{sub}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function QueueRowCard({
  row,
  expanded,
  onToggleExpand,
  onRetry,
  onAbandon,
  retrying,
}: {
  row: JournalRetryQueueListRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onRetry: () => void;
  onAbandon: () => void;
  retrying: boolean;
}) {
  const status = row.resolvedAt
    ? "resolved"
    : row.abandonedAt
      ? "abandoned"
      : "pending";
  return (
    <Card
      className={cn(
        "overflow-hidden p-0",
        status === "pending"
          ? "border-warning-300"
          : status === "resolved"
            ? "border-mahakan-green-200"
            : "border-neutral-200",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-sm font-semibold text-neutral-900">
              {row.hookDisplayName}
            </span>
            {row.retryCount > 0 ? (
              <Badge variant="neutral">
                {row.retryCount}× retry
              </Badge>
            ) : null}
          </div>
          {row.sourceSummary ? (
            <p className="mt-1 text-xs font-medium text-neutral-800">
              {row.sourceSummary}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-neutral-600">
            <Clock className="inline size-3 mr-1 align-text-bottom" />
            Gagal {formatDateTime(row.createdAt)}
            {row.sourceId ? (
              <>
                {" · ID "}
                <span className="font-mono">{row.sourceId.slice(0, 8)}…</span>
              </>
            ) : null}
          </p>
          <p className="mt-1.5 text-xs text-danger-700 line-clamp-2">
            {row.lastError}
          </p>
          {expanded ? (
            <div className="mt-2 space-y-2">
              {row.sourceContext.length > 0 ? (
                <div className="rounded border border-neutral-200 bg-white p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Detail Transaksi
                  </p>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                    {row.sourceContext.map((f) => (
                      <Fragment key={f.label}>
                        <dt className="text-neutral-500">{f.label}</dt>
                        <dd className="min-w-0 font-medium text-neutral-900">
                          {f.value}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              ) : null}
              <ErrorExplanation lastError={row.lastError} />
              <details className="text-[11px]">
                <summary className="cursor-pointer text-neutral-600">
                  Detail teknis (error + args — untuk developer)
                </summary>
                {row.lastErrorStack ? (
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-neutral-50 p-2 text-[10px] leading-tight text-neutral-700">
                    {row.lastErrorStack}
                  </pre>
                ) : null}
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-50 p-2 text-[10px] leading-tight text-neutral-700">
                  {JSON.stringify(row.hookArgs, null, 2)}
                </pre>
              </details>
              {row.resolvedAt ? (
                <p className="text-[11px] text-mahakan-green-700">
                  ✓ Resolved {formatDateTime(row.resolvedAt)} by{" "}
                  {row.resolvedByName ?? "—"}
                  {row.resolvedJournalEntryId ? (
                    <>
                      {" "}
                      · entry {row.resolvedJournalEntryId.slice(0, 8)}…
                    </>
                  ) : null}
                </p>
              ) : null}
              {row.abandonedAt ? (
                <p className="text-[11px] text-neutral-600">
                  ✗ Abandoned {formatDateTime(row.abandonedAt)} by{" "}
                  {row.abandonedByName ?? "—"} — {row.abandonedReason}
                </p>
              ) : null}
              {row.lastRetryAt ? (
                <p className="text-[11px] text-neutral-500">
                  Last retry {formatDateTime(row.lastRetryAt)} by{" "}
                  {row.lastRetryByName ?? "—"}
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-1.5 text-[11px] text-mahakan-green-700 hover:underline"
          >
            {expanded ? "Sembunyikan detail" : "Lihat detail transaksi"}
          </button>
        </div>
        {status === "pending" ? (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              loading={retrying}
            >
              <RotateCcw className="size-3.5" /> Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onAbandon}>
              Abandon
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Kotak penjelasan error berbahasa manusia + indikasi aman/tidaknya Retry. */
function ErrorExplanation({ lastError }: { lastError: string }) {
  const hint = explainError(lastError);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded border p-2.5 text-xs",
        hint?.safeToRetry === false
          ? "border-warning-300 bg-warning-50/60 text-warning-900"
          : "border-mahakan-green-200 bg-mahakan-green-50/40 text-neutral-800",
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Apa artinya error ini?</p>
        <p className="mt-0.5">
          {hint?.explanation ??
            "Pencatatan jurnal gagal karena error teknis. Transaksi aslinya aman tersimpan — cek Detail Transaksi di atas untuk memastikan ini transaksi yang mana, lalu klik Retry. Kalau gagal lagi, catat manual via Akuntansi → Jurnal Manual lalu Abandon."}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "pending" | "resolved" | "abandoned";
}) {
  if (status === "pending") {
    return <Badge variant="warning">Pending</Badge>;
  }
  if (status === "resolved") {
    return <Badge variant="success">Resolved</Badge>;
  }
  return <Badge variant="neutral">Abandoned</Badge>;
}
