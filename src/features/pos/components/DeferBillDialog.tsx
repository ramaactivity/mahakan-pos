"use client";

/**
 * Sesi AE-241 — "Bayar belakangan": last resort for a guest who left without
 * paying and could not be reached. Owner: this must never become an easy tab.
 *   - only two reasons exist (left/forgot, unreachable) — no "asked to owe";
 *   - what was tried must be written down;
 *   - an owner/manager other than the requester approves with their PIN;
 *   - a guarantor is named, with a promised pay date.
 * The server re-checks all of it (deferOpenBill) and refuses a second open
 * debt under the same guarantor.
 */

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import { deferOpenBill, isOk } from "@/features/transactions";
import { useCrewPicker } from "@/features/crew/CrewPicker";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApproverOverrideModal } from "./ApproverOverrideModal";

export interface DeferBillTarget {
  id: string;
  transactionNumber: string;
  customerName: string | null;
  total: number;
}

const REASONS = [
  { code: "guest_left", label: "Tamu sudah pulang / lupa bayar" },
  { code: "unreachable", label: "Tamu tidak bisa dihubungi" },
] as const;
type ReasonCode = (typeof REASONS)[number]["code"];

/** YYYY-MM-DD in WIB, `days` from today. */
function wibDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
}

export function DeferBillDialog({
  bill,
  onClose,
  onDeferred,
}: {
  bill: DeferBillTarget | null;
  onClose: () => void;
  onDeferred: () => void;
}) {
  const pickCrew = useCrewPicker();
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [effort, setEffort] = useState("");
  const [guarantor, setGuarantor] = useState("");
  const [contact, setContact] = useState("");
  const [dueDate, setDueDate] = useState(() => wibDate(1));
  const [approverOpen, setApproverOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bill) return null;

  const problem = !reason
    ? "Pilih alasan."
    : effort.trim().length < 15
      ? "Tulis usaha yang sudah dilakukan (minimal 15 huruf)."
      : guarantor.trim().length < 3
        ? "Isi penanggung jawab."
        : dueDate < wibDate(0)
          ? "Tanggal janji bayar tidak boleh sebelum hari ini."
          : null;

  function close() {
    if (submitting) return;
    setReason(null);
    setEffort("");
    setGuarantor("");
    setContact("");
    setDueDate(wibDate(1));
    setError(null);
    onClose();
  }

  async function submit(approverToken: string) {
    if (!bill || !reason) return;
    setSubmitting(true);
    setError(null);
    const crew = pickCrew ? await pickCrew("Ajukan bayar belakangan") : undefined;
    if (crew === null) {
      setSubmitting(false);
      return;
    }
    const res = await deferOpenBill({
      transactionId: bill.id,
      reasonCode: reason,
      effort: effort.trim(),
      guarantor: guarantor.trim(),
      contact: contact.trim() || null,
      dueDate,
      approverToken,
      crewId: crew?.id,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`${bill.transactionNumber} dicatat sebagai bayar belakangan`);
    close();
    onDeferred();
  }

  return (
    <>
      <Modal
        open
        onClose={close}
        title="Bayar belakangan"
        description={`${bill.transactionNumber} · ${bill.customerName ?? "—"} · ${formatRupiah(bill.total)}`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={submitting}>
              Kembali
            </Button>
            <Button disabled={problem !== null} loading={submitting} onClick={() => setApproverOpen(true)}>
              Minta persetujuan manager/owner
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg bg-warning-100 p-3 text-xs text-warning-700">
            <Clock className="size-4 shrink-0" />
            <p>
              Hanya untuk tamu yang <strong>sudah pergi dan benar-benar tidak bisa ditagih hari ini</strong>. Bukan
              untuk tamu yang minta ngutang. Tagih dulu, hubungi dulu. Semua pengajuan dilihat owner.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setReason(r.code)}
                className={cn(
                  "min-h-12 rounded-lg border px-3 text-left text-sm font-medium",
                  reason === r.code
                    ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-700"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Field label="Usaha yang sudah dilakukan" hint="Siapa menghubungi, lewat apa, jam berapa, hasilnya">
            <textarea
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="mis. Maul WA & telepon jam 22.40, tidak diangkat; sudah cek ke meja, tamu sudah pulang"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Penanggung jawab" hint="Yang menjamin tamu ini bayar">
              <input
                value={guarantor}
                onChange={(e) => setGuarantor(e.target.value)}
                maxLength={60}
                placeholder="mis. Adul (karyawan)"
                className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              />
            </Field>
            <Field label="Kontak tamu (opsional)">
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={30}
                inputMode="tel"
                className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              />
            </Field>
          </div>

          <Field label="Janji bayar">
            <input
              type="date"
              value={dueDate}
              min={wibDate(0)}
              onChange={(e) => setDueDate(e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
            />
          </Field>

          {problem && reason ? <p className="text-xs text-warning-500">{problem}</p> : null}
          {error ? <p className="text-sm text-danger-500">{error}</p> : null}
        </div>
      </Modal>

      <ApproverOverrideModal
        open={approverOpen}
        actionType="pos.bill.defer.approve"
        targetEntityId={bill.id}
        title="Persetujuan Bayar Belakangan"
        description="Manager/owner (bukan yang mengajukan) memasukkan PIN untuk menyetujui."
        onClose={() => setApproverOpen(false)}
        onVerified={({ token }) => {
          setApproverOpen(false);
          void submit(token);
        }}
      />
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-neutral-800">{label}</p>
      {hint ? <p className="mb-1 text-xs text-neutral-500">{hint}</p> : null}
      {children}
    </div>
  );
}
