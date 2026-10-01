"use client";

/**
 * Sesi AE-240 — cancel an open bill with a reason that can be checked.
 *
 * Owner: a bill cancelled as "Pindah bill" with no bill it moved to
 * (TRX-20260826-0008 Sekal) must not be possible. Two steps:
 *   1. pick a reason chip and supply its proof (out-of-stock items, or the
 *      target bill), 2. confirm a plain summary — then the crew picker.
 * The server re-checks everything (cancelOpenBill + cancel-reason.ts).
 * There is no "already paid" reason on purpose: a paid bill is closed.
 */

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  cancelOpenBill,
  isOk,
  type TransactionSummary,
  type TransactionWithItems,
} from "@/features/transactions";
import {
  CANCEL_REASONS,
  cancelReasonProblem,
  cancelReasonSpec,
  formatCancelReason,
  type CancelReasonCode,
} from "@/features/transactions/cancel-reason";
import { useCrewPicker } from "@/features/crew/CrewPicker";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  bill: TransactionWithItems | null;
  /** Other open bills on the panel — quick picks for the target bill. */
  otherOpenBills: TransactionSummary[];
  onClose: () => void;
  onCancelled: () => void;
}

const shortNo = (n: string) => n.slice(-4);
const itemLabel = (i: TransactionWithItems["items"][number]) =>
  `${i.quantity}× ${i.itemName}${i.variant ? ` (${i.variant})` : ""}`;

export function CancelOpenBillDialog({ bill, otherOpenBills, onClose, onCancelled }: Props) {
  const pickCrew = useCrewPicker();
  const [code, setCode] = useState<CancelReasonCode | null>(null);
  const [detail, setDetail] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [targetBill, setTargetBill] = useState("");
  const [markSoldOut, setMarkSoldOut] = useState(true);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bill) return null;
  const spec = code ? cancelReasonSpec(code) : null;
  const problem = code ? cancelReasonProblem({ reasonCode: code, detail, itemIds, targetBill }) : "Pilih alasan.";
  const targets = otherOpenBills.filter((b) => b.id !== bill.id);
  const pickedItems = bill.items.filter((i) => itemIds.includes(i.id));
  const summary = code
    ? formatCancelReason(code, {
        detail,
        itemNames: pickedItems.map(itemLabel),
        targetNumber: targetBill.trim() || null,
      })
    : "";

  function reset() {
    setCode(null);
    setDetail("");
    setItemIds([]);
    setTargetBill("");
    setMarkSoldOut(true);
    setStep("form");
    setError(null);
  }
  function close() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    if (!bill || !code) return;
    setSubmitting(true);
    setError(null);
    const crew = pickCrew ? await pickCrew("Batalkan open bill") : undefined;
    if (crew === null) {
      setSubmitting(false);
      return;
    }
    const res = await cancelOpenBill({
      transactionId: bill.id,
      reasonCode: code,
      detail: detail.trim() || null,
      itemIds: spec?.needsItems ? itemIds : undefined,
      targetBill: spec?.needsTargetBill ? targetBill.trim() : null,
      markSoldOut: spec?.needsItems ? markSoldOut : undefined,
      crewId: crew?.id,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      // Server is the judge (e.g. target bill not in this shift) — go back to fix it.
      setError(res.error.message);
      setStep("form");
      return;
    }
    toast.success(`Bill ${bill.transactionNumber} dibatalkan`);
    reset();
    onCancelled();
  }

  return (
    <Modal
      open
      onClose={close}
      title={step === "form" ? "Kenapa bill ini dibatalkan?" : "Konfirmasi pembatalan"}
      description={`Bill ${bill.transactionNumber} · ${bill.customerName ?? "—"} · ${formatRupiah(bill.total)}`}
      size="md"
      footer={
        step === "form" ? (
          <>
            <Button variant="ghost" onClick={close}>
              Kembali
            </Button>
            <Button
              disabled={problem !== null}
              onClick={() => {
                setError(null);
                setStep("confirm");
              }}
            >
              Lanjut
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("form")} disabled={submitting}>
              Ubah alasan
            </Button>
            <Button variant="destructive" onClick={() => void submit()} loading={submitting}>
              <Trash2 className="size-4" aria-hidden /> Ya, batalkan bill
            </Button>
          </>
        )
      }
    >
      {step === "form" ? (
        <div className="space-y-4">
          <p className="rounded-md bg-neutral-100 p-3 text-xs text-neutral-700">
            Tamu sudah bayar? Jangan dibatalkan — tutup bill lewat tombol <strong>Bayar</strong>.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {CANCEL_REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => {
                  setCode(r.code);
                  setError(null);
                }}
                className={cn(
                  "min-h-12 rounded-lg border px-3 text-left text-sm font-medium",
                  code === r.code
                    ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-700"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {spec ? <p className="text-xs text-neutral-600">{spec.hint}</p> : null}

          {spec?.needsItems ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-800">Item yang habis</p>
              {bill.items.map((i) => (
                <label key={i.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={itemIds.includes(i.id)}
                    onChange={(e) =>
                      setItemIds((ids) => (e.target.checked ? [...ids, i.id] : ids.filter((x) => x !== i.id)))
                    }
                  />
                  <span className="text-sm text-neutral-800">{itemLabel(i)}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={markSoldOut} onChange={(e) => setMarkSoldOut(e.target.checked)} />
                Tandai menu ini <strong>Habis</strong> di POS
              </label>
            </div>
          ) : null}

          {spec?.needsTargetBill ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-800">
                {code === "duplicate_input" ? "Bill yang benar" : "Bill tujuan"}
              </p>
              {targets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {targets.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setTargetBill(b.transactionNumber)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm",
                        targetBill === b.transactionNumber
                          ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-700"
                          : "border-neutral-200 bg-white text-neutral-700",
                      )}
                    >
                      <span className="font-mono">{shortNo(b.transactionNumber)}</span> · {b.customerName ?? "—"} ·{" "}
                      {formatRupiah(b.total)}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                value={targetBill}
                onChange={(e) => setTargetBill(e.target.value)}
                maxLength={30}
                placeholder="Atau ketik nomor bill (4 digit terakhir), termasuk bill yang sudah dibayar"
                className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              />
            </div>
          ) : null}

          {spec ? (
            <div>
              <label className="text-sm font-medium text-neutral-800" htmlFor="cancel-detail">
                Keterangan{spec.minDetail === 0 ? " (opsional)" : ""}
              </label>
              <input
                id="cancel-detail"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={150}
                placeholder={code === "customer_left" ? "mis. tamu pulang, pesanan belum dibuat" : "Tulis keterangan"}
                className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              />
            </div>
          ) : null}

          {code && problem ? <p className="text-xs text-warning-500">{problem}</p> : null}
          {error ? <p className="text-sm text-danger-500">{error}</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <p className="font-semibold text-neutral-900">{bill.transactionNumber}</p>
            <p className="text-neutral-600">
              {bill.customerName ?? "—"} · {formatRupiah(bill.total)}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-neutral-700">
              {bill.items.map((i) => (
                <li key={i.id}>{itemLabel(i)}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-mahakan-green-200 bg-mahakan-green-50 p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Alasan</p>
            <p className="font-medium text-neutral-900">{summary}</p>
          </div>
          <div className="flex gap-2 rounded-lg bg-warning-100 p-3 text-xs text-warning-700">
            <AlertTriangle className="size-4 shrink-0" />
            <p>
              Bill tidak bisa dibuka lagi. Alasan, nama crew, dan isi bill tercatat di Audit Log dan dilihat owner.
              {code === "out_of_stock" && markSoldOut ? " Menu yang dicentang akan ditandai Habis." : ""}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
