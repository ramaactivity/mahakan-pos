"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageIcon,
  Receipt,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  fetchCashDepositDashboard,
  rejectCashDeposit,
  verifyCashDeposit,
} from "@/features/finance/actions";
import type { CashDeposit } from "@/features/finance/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDate } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  deposit: CashDeposit | null;
}

const REJECT_TEMPLATES = [
  "Foto bukti kurang jelas / blur",
  "Belum sampai ke bank",
  "Jumlah tidak match dengan slip",
  "Tujuan bank salah",
] as const;

const VARIANCE_THRESHOLD = 10_000;

/**
 * Sesi AE-9 redesign — VerifyDepositModal full-screen 2-col mirror
 * CloseShiftModal pattern. Side-by-side variance comparison + reject
 * reason templates + photo preview prominent.
 *
 * Owner workflow:
 *   1. LEFT col: photo bukti besar + metadata (kasir, tanggal, periode)
 *   2. RIGHT col: side-by-side "Setoran" vs "Kas Tersedia" + variance badge
 *   3. Tap Verifikasi → server validates photoUrl exists → status=verified
 *   4. Tap Tolak → pilih template / ketik reason → status=rejected
 *
 * Layout WAJIB comply rules dari feedback_pos_primary_device.md:
 *   grid-rows-1 + lg:max-h-[calc(92vh-9rem)] + min-h-0 + overscrollBehavior
 */
export function VerifyDepositModal({
  open,
  onClose,
  onChanged,
  deposit,
}: Props) {
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sesi AE-13 — share cache dengan SetoranTunaiSection. TanStack dedupe
  // by key, so opening VerifyDepositModal saat dashboard already loaded =
  // instant (no roundtrip).
  const dashboardQuery = useQuery({
    queryKey: ["finance", "deposit-dashboard"],
    queryFn: async () => {
      const res = await fetchCashDepositDashboard();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: open && deposit !== null,
  });
  const cashOnHand = dashboardQuery.data?.cashOnHand ?? null;

  useEffect(() => {
    if (!open || !deposit) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode("verify");
    setReason("");
    setSubmitting(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, deposit]);

  const variance = useMemo(() => {
    if (!deposit || cashOnHand === null) return null;
    // Positif = deposit > cashOnHand (suspect: kasir bawa kas dari mana?)
    // Negatif = deposit < cashOnHand (kasir bawa kas pulang? OK kalau ada catatan)
    return deposit.amount - cashOnHand;
  }, [deposit, cashOnHand]);

  const varianceFlag: "match" | "small" | "warn" | null = useMemo(() => {
    if (variance === null) return null;
    const abs = Math.abs(variance);
    if (abs === 0) return "match";
    if (abs <= VARIANCE_THRESHOLD) return "small";
    return "warn";
  }, [variance]);

  if (!deposit) return null;

  async function onSubmit(opts: { acknowledgeNegativeCash?: boolean } = {}) {
    if (!deposit) return;
    setError(null);
    if (mode === "reject" && reason.trim().length < 3) {
      setError("Alasan tolak minimal 3 karakter");
      return;
    }
    setSubmitting(true);
    try {
      const res =
        mode === "verify"
          ? await verifyCashDeposit({
              id: deposit.id,
              acknowledgeNegativeCash: opts.acknowledgeNegativeCash,
            })
          : await rejectCashDeposit({
              id: deposit.id,
              reason: reason.trim(),
            });
      if (res.ok) {
        toast.success(
          mode === "verify"
            ? `Setoran ${formatRupiah(deposit.amount)} diverifikasi`
            : "Setoran ditolak",
        );
        onChanged();
        onClose();
      } else {
        // Sesi AE-62k — kalau backend reject karena bikin cashOnHand minus
        // (NEGATIVE_CASH_NOT_ACKNOWLEDGED), tampil confirm dialog dengan
        // explicit acknowledgement supaya owner sadar consequences.
        if (res.error.code === "NEGATIVE_CASH_NOT_ACKNOWLEDGED") {
          const confirmed = window.confirm(
            `${res.error.message}\n\nLanjut verify dengan flag override? Audit log akan mencatat acknowledgement Anda.`,
          );
          if (confirmed) {
            // Retry with ack flag.
            setSubmitting(false);
            void onSubmit({ acknowledgeNegativeCash: true });
            return;
          }
          setError("Verifikasi dibatalkan — cek refund/expense yang belum ter-record dulu.");
        } else {
          setError(res.error.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function applyTemplate(t: string) {
    if (reason.trim().length === 0) {
      setReason(t);
    } else {
      setReason(`${reason.trim()} — ${t}`);
    }
  }

  const photoIsImage =
    deposit.photoUrl && /\.(jpe?g|png|webp|gif)$/i.test(deposit.photoUrl);

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Verifikasi Setoran Tunai"
      description={`${formatRupiah(deposit.amount)} → ${deposit.bankDestination} · ${formatIndonesianDate(deposit.depositDate)}`}
      size="fullscreen"
      bodyPadding="none"
      disableEscClose={submitting}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={() => onSubmit()}
            loading={submitting}
            disabled={
              submitting ||
              (mode === "reject" && reason.trim().length < 3)
            }
            size="xl"
            variant={mode === "reject" ? "outline" : "primary"}
            className={cn(
              "!h-12 min-w-[200px] touch:min-w-[260px] !text-base",
              mode === "reject" && "!border-danger-500 !text-danger-700",
            )}
          >
            {mode === "verify" ? (
              <>
                <ShieldCheck className="size-5" aria-hidden /> Verifikasi
                Setoran
              </>
            ) : (
              <>
                <X className="size-5" aria-hidden /> Tolak Setoran
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="grid h-full min-h-0 grid-rows-1 divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
        {/* ============ LEFT — Bukti + Metadata ============ */}
        <aside
          className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-neutral-50 p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
          style={{ overscrollBehavior: "contain" }}
        >
          <PhotoPreview
            photoUrl={deposit.photoUrl}
            isImage={photoIsImage}
          />
          <MetadataPanel deposit={deposit} />
        </aside>

        {/* ============ RIGHT — Comparison + Action ============ */}
        <div
          className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
          style={{ overscrollBehavior: "contain" }}
        >
          {/* Mode tabs */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-neutral-100 p-1.5">
            <ModeButton
              active={mode === "verify"}
              accent="green"
              onClick={() => setMode("verify")}
              Icon={ShieldCheck}
              label="Verifikasi"
              hint="Approve setoran ke bank/owner"
            />
            <ModeButton
              active={mode === "reject"}
              accent="red"
              onClick={() => setMode("reject")}
              Icon={X}
              label="Tolak"
              hint="Reject + minta perbaikan"
            />
          </div>

          {/* Comparison panel — hanya tampil di mode verify */}
          {mode === "verify" ? (
            <ComparisonPanel
              depositAmount={deposit.amount}
              cashOnHand={cashOnHand}
              variance={variance}
              varianceFlag={varianceFlag}
            />
          ) : null}

          {/* Reject reason templates + textarea */}
          {mode === "reject" ? (
            <RejectReasonPanel
              reason={reason}
              setReason={setReason}
              applyTemplate={applyTemplate}
              submitting={submitting}
            />
          ) : null}

          {/* Audit context — always visible */}
          <AuditContext deposit={deposit} />

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// LEFT: Photo preview
// ============================================================

function PhotoPreview({
  photoUrl,
  isImage,
}: {
  photoUrl: string | null;
  isImage: boolean | null | "" | undefined;
}) {
  if (!photoUrl) {
    return (
      <section className="rounded-xl border-2 border-dashed border-warning-300 bg-warning-50 p-6 text-center">
        <AlertTriangle
          className="mx-auto mb-2 size-8 text-warning-500"
          aria-hidden
        />
        <p className="text-sm font-semibold text-warning-700">
          Foto bukti belum di-upload
        </p>
        <p className="mt-1 text-xs text-warning-600">
          Tutup modal ini, klik Edit di list, upload foto, baru bisa
          verifikasi. Anti-fraud.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Foto Bukti Transfer
      </h3>
      <a
        href={photoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-xl border-2 border-mahakan-green-700/30 bg-white shadow-sm transition-all hover:border-mahakan-green-700"
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="Bukti setoran"
            className="block max-h-[400px] w-full object-contain bg-neutral-50"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-8">
            <FileText
              className="size-10 text-mahakan-green-700"
              aria-hidden
            />
            <p className="text-sm font-semibold text-mahakan-green-900">
              File PDF / Drive Link
            </p>
            <p className="text-xs text-neutral-600">
              Tap untuk buka di tab baru
            </p>
          </div>
        )}
        <div className="flex items-center justify-center gap-1.5 border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-medium text-mahakan-green-900 transition-colors group-hover:bg-mahakan-green-50">
          <ExternalLink className="size-3.5" aria-hidden />
          Buka full-size di tab baru
        </div>
      </a>
    </section>
  );
}

// ============================================================
// LEFT: Metadata panel
// ============================================================

function MetadataPanel({ deposit }: { deposit: CashDeposit }) {
  return (
    <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4 touch:p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Detail Setoran
      </h3>
      <MetaRow
        Icon={Calendar}
        label="Tanggal Setor"
        value={formatIndonesianDate(deposit.depositDate)}
      />
      <MetaRow
        Icon={Building2}
        label="Tujuan Setoran"
        value={deposit.bankDestination}
      />
      {deposit.referenceNo ? (
        <MetaRow
          Icon={Receipt}
          label="No. Referensi"
          value={deposit.referenceNo}
        />
      ) : null}
      <MetaRow
        Icon={Calendar}
        label="Periode Kas"
        value={`${formatIndonesianDate(deposit.coversFromDate)} → ${formatIndonesianDate(deposit.coversToDate)}`}
      />
      {deposit.notes ? (
        <div className="mt-2 rounded-md bg-neutral-50 p-2 text-xs italic text-neutral-700">
          &ldquo;{deposit.notes}&rdquo;
        </div>
      ) : null}
    </section>
  );
}

function MetaRow({
  Icon,
  label,
  value,
}: {
  Icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-neutral-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
          {label}
        </p>
        <p className="truncate font-medium text-neutral-900">{value}</p>
      </div>
    </div>
  );
}

// ============================================================
// RIGHT: Comparison panel (Submitted vs System Expected)
// ============================================================

function ComparisonPanel({
  depositAmount,
  cashOnHand,
  variance,
  varianceFlag,
}: {
  depositAmount: number;
  cashOnHand: number | null;
  variance: number | null;
  varianceFlag: "match" | "small" | "warn" | null;
}) {
  const flagClasses = {
    match: "border-success-500 bg-success-100 text-success-500",
    small: "border-warning-500 bg-warning-100 text-warning-500",
    warn: "border-danger-500 bg-danger-100 text-danger-700",
  };

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
        Perbandingan Nominal
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <CompareCard
          title="Setoran"
          subtitle="Dari kasir"
          amount={depositAmount}
          accent="primary"
        />
        <CompareCard
          title="Kas Tersedia"
          subtitle="Sistem (saat ini)"
          amount={cashOnHand}
          accent={cashOnHand === null ? "loading" : "neutral"}
        />
      </div>

      {variance !== null && varianceFlag !== null ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border-2 px-4 py-3",
            flagClasses[varianceFlag],
          )}
        >
          {varianceFlag === "match" ? (
            <CheckCircle2 className="size-5 shrink-0" />
          ) : (
            <AlertTriangle className="size-5 shrink-0" />
          )}
          <div className="flex flex-1 items-baseline justify-between gap-2">
            <span className="font-semibold text-sm">
              {varianceFlag === "match"
                ? "Match — kas pas dengan setoran"
                : variance > 0
                  ? "Setoran > Kas tersedia"
                  : "Setoran < Kas tersedia"}
            </span>
            <span className="font-mono text-base font-bold">
              {variance >= 0 ? "+" : ""}
              {formatRupiah(variance)}
            </span>
          </div>
        </div>
      ) : null}

      {varianceFlag === "warn" ? (
        <p className="text-[11px] text-danger-700">
          ⚠ Selisih lebih dari {formatRupiah(VARIANCE_THRESHOLD)}.{" "}
          {variance && variance > 0
            ? "Setoran lebih besar dari kas tersedia — confirm sumber dana sebelum approve."
            : "Setoran lebih kecil dari kas tersedia — apakah ada kas yang ditahan? Konfirm dengan kasir."}
        </p>
      ) : varianceFlag === "small" ? (
        <p className="text-[11px] text-warning-700">
          Selisih ringan ({formatRupiah(Math.abs(variance ?? 0))}). Wajar untuk
          rounding atau split deposit.
        </p>
      ) : varianceFlag === "match" ? (
        <p className="text-[11px] text-success-700">
          Nominal cocok persis dengan kas tersedia. Aman untuk approve.
        </p>
      ) : null}
    </section>
  );
}

function CompareCard({
  title,
  subtitle,
  amount,
  accent,
}: {
  title: string;
  subtitle: string;
  amount: number | null;
  accent: "primary" | "neutral" | "loading";
}) {
  const accentClasses = {
    primary: "border-mahakan-green-700 bg-mahakan-green-50",
    neutral: "border-neutral-300 bg-white",
    loading: "border-neutral-200 bg-neutral-50",
  }[accent];
  return (
    <div className={cn("rounded-xl border-2 p-3 touch:p-2", accentClasses)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
        {title}
      </p>
      <p className="text-[10px] text-neutral-500">{subtitle}</p>
      <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-neutral-900 touch:text-xl">
        {amount === null ? "…" : formatRupiah(amount)}
      </p>
    </div>
  );
}

// ============================================================
// RIGHT: Reject reason
// ============================================================

function RejectReasonPanel({
  reason,
  setReason,
  applyTemplate,
  submitting,
}: {
  reason: string;
  setReason: (v: string) => void;
  applyTemplate: (t: string) => void;
  submitting: boolean;
}) {
  const remaining = 500 - reason.length;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-danger-700">
        Alasan Tolak
      </h3>
      <p className="text-xs text-neutral-600">
        Tap chip untuk template cepat, atau ketik bebas. Alasan disimpan di
        audit log + visible ke kasir.
      </p>
      <div className="flex flex-wrap gap-1">
        {REJECT_TEMPLATES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => applyTemplate(t)}
            disabled={submitting}
            className={cn(
              "rounded-full border border-danger-300 bg-danger-50 px-2.5 py-1 text-[11px] font-medium text-danger-700 transition-colors",
              "hover:bg-danger-100 active:scale-95",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            + {t}
          </button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 500))}
        rows={4}
        placeholder="Misal: jumlah di slip Rp 1.500.000 tapi yang dicatat Rp 1.000.000. Cek ulang slip."
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 touch:text-[13px]"
        disabled={submitting}
      />
      <div className="flex items-center justify-between">
        <p
          className={cn(
            "text-[11px]",
            reason.trim().length < 3
              ? "text-danger-700"
              : "text-neutral-500",
          )}
        >
          {reason.trim().length < 3
            ? "Minimal 3 karakter"
            : "Alasan terisi"}
        </p>
        <span
          className={cn(
            "text-[10px]",
            remaining < 50 ? "text-warning-500" : "text-neutral-500",
          )}
        >
          {remaining} char tersisa
        </span>
      </div>
    </section>
  );
}

// ============================================================
// RIGHT: Audit context strip
// ============================================================

function AuditContext({ deposit }: { deposit: CashDeposit }) {
  return (
    <section className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-[11px] text-neutral-600">
      <div className="flex items-center gap-1.5">
        <User className="size-3.5 text-neutral-500" aria-hidden />
        <span>
          Submitted{" "}
          <strong>
            {new Date(deposit.createdAt).toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Jakarta",
            })}
          </strong>
        </span>
      </div>
      <p className="mt-1 italic">
        Setelah verify, journal akuntansi otomatis fired (debit bank /
        kredit kas tunai). Setelah reject, kasir bisa edit & resubmit.
      </p>
    </section>
  );
}

function ModeButton({
  active,
  accent,
  onClick,
  Icon,
  label,
  hint,
}: {
  active: boolean;
  accent: "green" | "red";
  onClick: () => void;
  Icon: typeof ShieldCheck | typeof X | typeof ImageIcon;
  label: string;
  hint: string;
}) {
  const activeClasses =
    accent === "green"
      ? "bg-mahakan-green-700 text-white"
      : "bg-danger-500 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-center transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? activeClasses
          : "bg-white text-neutral-700 hover:bg-neutral-50",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          "text-[10px]",
          active ? "text-white/80" : "text-neutral-500",
        )}
      >
        {hint}
      </span>
    </button>
  );
}
