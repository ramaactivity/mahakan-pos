"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Skull, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import {
  getInvestorModuleSnapshot,
  type InvestorModuleSnapshot,
  wipeInvestorModuleData,
} from "@/features/investors";

const REQUIRED_CONFIRMATION = "HAPUS SEMUA";

interface WipeModuleButtonProps {
  isOwner: boolean;
}

/**
 * Sesi AE-160f — Tombol owner-only untuk wipe seluruh modul Investor /
 * Pengelola / Kreditur. Triple-safeguard:
 *   1. Owner-only di server (role check) + UI (hide tombol untuk non-owner)
 *   2. Multi-confirm modal: review snapshot row count, centang 2 acknowledge
 *      box, ketik "HAPUS SEMUA" persis, baru tombol Wipe aktif
 *   3. Server check confirmation string match — kalau tidak match → reject
 *
 * Tidak ada undo. Owner harus backup Neon DB (point-in-time recovery 7
 * hari) kalau mau rollback. Audit log nama owner + total row deleted.
 */
export function WipeModuleButton({ isOwner }: WipeModuleButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<InvestorModuleSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setConfirmation("");
    setAck1(false);
    setAck2(false);
    setSubmitting(false);
    setSnapshot(null);
    setLoadingSnapshot(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void getInvestorModuleSnapshot().then((res) => {
      if (cancelled) return;
      if (res.success) setSnapshot(res.data);
      else toast.error(res.error.message);
      setLoadingSnapshot(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!isOwner) return null;

  const canSubmit =
    snapshot !== null &&
    ack1 &&
    ack2 &&
    confirmation === REQUIRED_CONFIRMATION &&
    !submitting;

  async function handleWipe() {
    if (!canSubmit) return;
    setSubmitting(true);
    const res = await wipeInvestorModuleData({
      confirmation: REQUIRED_CONFIRMATION,
    });
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Wipe selesai: ${res.data.rowsDeleted.totalRows} row dihapus. Owner bisa input ulang via CSV.`,
    );
    setOpen(false);
    /* Invalidate semua query investor module — biar UI refresh ke empty state. */
    queryClient.invalidateQueries({ queryKey: ["admin", "investors"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "pengelola"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "creditors"] });
    queryClient.invalidateQueries({
      queryKey: ["admin", "creditor-repayments"],
    });
    queryClient.invalidateQueries({
      queryKey: ["admin", "share-transactions"],
    });
    queryClient.invalidateQueries({ queryKey: ["admin", "withdrawals"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "distributions"] });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-danger-300 text-danger-700 hover:bg-danger-50"
      >
        <Skull className="size-4" aria-hidden />
        Reset Modul
      </Button>

      <Modal
        open={open}
        onClose={submitting ? () => undefined : () => setOpen(false)}
        title="Reset Modul Investor / Pengelola / Kreditur"
        description="Operasi destruktif — hapus PERMANEN seluruh data modul ini. Tidak bisa di-undo dari UI. Backup database via Neon Console kalau ragu."
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={handleWipe}
              disabled={!canSubmit}
              loading={submitting}
              variant="destructive"
            >
              <Trash2 className="size-4" />
              Wipe Sekarang
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-neutral-500">
              <Loader2 className="size-4 animate-spin" />
              Menghitung row yang akan dihapus…
            </div>
          ) : snapshot ? (
            <>
              <div className="rounded-md border border-danger-300 bg-danger-50 p-3">
                <p className="flex items-start gap-2 font-semibold text-danger-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Akan dihapus {snapshot.totalRows.toLocaleString("id-ID")}{" "}
                    row dari outlet ini:
                  </span>
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-danger-900">
                  <CountRow label="Investor" n={snapshot.investors} />
                  <CountRow label="Pengelola" n={snapshot.pengelola} />
                  <CountRow label="Kreditur" n={snapshot.creditors} />
                  <CountRow
                    label="Mutasi saham"
                    n={snapshot.shareTransactions}
                  />
                  <CountRow
                    label="Capital movements"
                    n={snapshot.capitalMovements}
                  />
                  <CountRow
                    label="Pencairan dividen"
                    n={snapshot.withdrawalRequests}
                  />
                  <CountRow
                    label="Cicilan kreditur"
                    n={snapshot.creditorRepayments}
                  />
                  <CountRow
                    label="Distribusi (header)"
                    n={snapshot.profitDistributions}
                  />
                  <CountRow
                    label="Distribusi (lines)"
                    n={snapshot.profitDistributionLines}
                  />
                  <CountRow
                    label="Email statement"
                    n={snapshot.investorStatementEmails}
                  />
                </ul>
              </div>

              <label className="flex items-start gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={ack1}
                  onChange={(e) => setAck1(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Saya paham operasi ini <strong>permanen</strong>. Row akan
                  hilang dari database — bukan soft-delete.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={ack2}
                  onChange={(e) => setAck2(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Saya sudah backup database (Neon point-in-time recovery 7
                  hari) atau menerima risiko data hilang. Tidak akan minta
                  rollback dari support.
                </span>
              </label>

              <Input
                label={`Ketik "${REQUIRED_CONFIRMATION}" persis untuk konfirmasi`}
                placeholder={REQUIRED_CONFIRMATION}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />

              <p className="rounded-md bg-warning-50 px-3 py-2 text-[11px] text-warning-900">
                Setelah wipe selesai, owner bisa input ulang via tombol{" "}
                <strong>Import CSV</strong> di masing-masing tab (Investor /
                Pengelola / Kreditur).
              </p>
            </>
          ) : (
            <p className="text-danger-700">
              Gagal load snapshot. Refresh halaman dan coba lagi.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

function CountRow({ label, n }: { label: string; n: number }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono font-semibold">
        {n.toLocaleString("id-ID")}
      </span>
    </li>
  );
}
