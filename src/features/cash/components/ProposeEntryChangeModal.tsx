"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Mail, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import {
  isOk,
  listExpenseCategories,
  proposeEntryChange,
  type Expense,
  type ExpenseCategory,
  type Income,
} from "@/features/cash";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-67 — Modal staff propose EDIT / DELETE entry pengeluaran / pemasukan.
 *
 * Workflow: staff isi form → submit → server email kode 6-digit ke owner
 * → owner approve via Pending Approvals panel di Back Office.
 *
 * Mirror UX pattern ShiftRebalanceModal (sesi AE-66): 2-col grid (kiri:
 * data lama vs data baru, kanan: alasan + warning), success screen
 * tampil kode 2-digit hint + masked email.
 */
export interface ProposeEntryChangeModalProps {
  open: boolean;
  mode: "edit" | "delete";
  entityType: "expense" | "income";
  /** Entity yang akan di-koreksi. Expense atau Income. */
  entity: Expense | Income | null;
  shiftId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Tunai" },
  { value: "transfer", label: "Transfer" },
  { value: "other", label: "Lainnya" },
] as const;

function isExpense(e: Expense | Income): e is Expense {
  return "categoryId" in e;
}

function getEntityDate(e: Expense | Income): string {
  return isExpense(e)
    ? String((e as Expense).expenseDate)
    : String((e as Income).incomeDate);
}

export function ProposeEntryChangeModal({
  open,
  mode,
  entityType,
  entity,
  shiftId,
  onClose,
  onSubmitted,
}: ProposeEntryChangeModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    codeFirstTwo: string;
    ownerEmailMasked: string;
    emailMode: "sent" | "logged" | "failed";
  } | null>(null);

  // Edit form fields (pre-filled from entity)
  const [dateValue, setDateValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [paymentMethodValue, setPaymentMethodValue] = useState<"cash" | "transfer" | "other">("cash");
  const [categoryIdValue, setCategoryIdValue] = useState("");
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  // Load categories (for expense edit)
  useEffect(() => {
    if (!open || entityType !== "expense" || mode !== "edit") return;
    let cancelled = false;
    void listExpenseCategories().then((res) => {
      if (cancelled) return;
      if (isOk(res)) setCategories(res.data.items);
    });
    return () => {
      cancelled = true;
    };
  }, [open, entityType, mode]);

  // Pre-fill form on entity change
  useEffect(() => {
    if (!entity) return;
    setDateValue(getEntityDate(entity));
    setDescriptionValue(entity.description ?? "");
    setAmountRaw(String(entity.amount));
    setPaymentMethodValue(entity.paymentMethod as "cash" | "transfer" | "other");
    if (isExpense(entity)) {
      setCategoryIdValue(entity.categoryId);
    }
  }, [entity]);

  function resetAll() {
    setReason("");
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }

  if (!entity) return null;

  const amountNum = (() => {
    const n = parseInt(amountRaw.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Compute diff for live preview (edit mode only)
  const diff: Array<{ label: string; oldValue: string; newValue: string }> = [];
  if (mode === "edit") {
    if (isExpense(entity)) {
      const e = entity as Expense;
      if (dateValue !== String(e.expenseDate)) {
        diff.push({ label: "Tanggal", oldValue: String(e.expenseDate), newValue: dateValue });
      }
      if (amountNum != null && amountNum !== Number(e.amount)) {
        diff.push({
          label: "Nominal",
          oldValue: `Rp ${formatRupiah(Number(e.amount))}`,
          newValue: `Rp ${formatRupiah(amountNum)}`,
        });
      }
      if (descriptionValue.trim() !== (e.description ?? "")) {
        diff.push({ label: "Deskripsi", oldValue: e.description ?? "—", newValue: descriptionValue.trim() });
      }
      if (paymentMethodValue !== e.paymentMethod) {
        diff.push({
          label: "Metode",
          oldValue: PAYMENT_METHODS.find((p) => p.value === e.paymentMethod)?.label ?? String(e.paymentMethod),
          newValue: PAYMENT_METHODS.find((p) => p.value === paymentMethodValue)?.label ?? paymentMethodValue,
        });
      }
      if (categoryIdValue !== e.categoryId) {
        diff.push({
          label: "Kategori",
          oldValue: categories.find((c) => c.id === e.categoryId)?.name ?? "—",
          newValue: categories.find((c) => c.id === categoryIdValue)?.name ?? "—",
        });
      }
    } else {
      const i = entity as Income;
      if (dateValue !== String(i.incomeDate)) {
        diff.push({ label: "Tanggal", oldValue: String(i.incomeDate), newValue: dateValue });
      }
      if (amountNum != null && amountNum !== Number(i.amount)) {
        diff.push({
          label: "Nominal",
          oldValue: `Rp ${formatRupiah(Number(i.amount))}`,
          newValue: `Rp ${formatRupiah(amountNum)}`,
        });
      }
      if (descriptionValue.trim() !== (i.description ?? "")) {
        diff.push({ label: "Deskripsi", oldValue: i.description ?? "—", newValue: descriptionValue.trim() });
      }
      if (paymentMethodValue !== i.paymentMethod) {
        diff.push({
          label: "Metode",
          oldValue: PAYMENT_METHODS.find((p) => p.value === i.paymentMethod)?.label ?? String(i.paymentMethod),
          newValue: PAYMENT_METHODS.find((p) => p.value === paymentMethodValue)?.label ?? paymentMethodValue,
        });
      }
    }
  }

  const hasDiff = mode === "delete" || diff.length > 0;
  const canSubmit = reason.trim().length >= 3 && hasDiff && (mode === "delete" || amountNum != null);

  async function onSubmit() {
    if (!entity) return;
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);

    let proposedData: Record<string, unknown> | undefined;
    if (mode === "edit") {
      const draft: Record<string, unknown> = {};
      if (isExpense(entity)) {
        const e = entity as Expense;
        if (dateValue !== String(e.expenseDate)) draft.expenseDate = dateValue;
        if (amountNum != null && amountNum !== Number(e.amount)) draft.amount = amountNum;
        if (descriptionValue.trim() !== (e.description ?? "")) draft.description = descriptionValue.trim();
        if (paymentMethodValue !== e.paymentMethod) draft.paymentMethod = paymentMethodValue;
        if (categoryIdValue !== e.categoryId) draft.categoryId = categoryIdValue;
      } else {
        const i = entity as Income;
        if (dateValue !== String(i.incomeDate)) draft.incomeDate = dateValue;
        if (amountNum != null && amountNum !== Number(i.amount)) draft.amount = amountNum;
        if (descriptionValue.trim() !== (i.description ?? "")) draft.description = descriptionValue.trim();
        if (paymentMethodValue !== i.paymentMethod) draft.paymentMethod = paymentMethodValue;
      }
      proposedData = draft;
    }

    const res = await proposeEntryChange({
      operation: mode === "edit" ? "update" : "delete",
      entityType,
      entityId: entity.id,
      proposedData,
      reason: reason.trim(),
      shiftId,
    } as Parameters<typeof proposeEntryChange>[0]);

    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    setSuccess({
      codeFirstTwo: res.data.codeFirstTwo,
      ownerEmailMasked: res.data.ownerEmailMasked,
      emailMode: res.data.emailMode,
    });
    toast.success(
      res.data.emailMode === "sent"
        ? `Kode terkirim ke ${res.data.ownerEmailMasked}`
        : res.data.emailMode === "logged"
          ? "Kode di-log (dev mode)"
          : "Email gagal — Owner perlu cek pengaturan",
    );
    onSubmitted();
  }

  const operationLabel = mode === "edit" ? "Edit" : "Hapus";
  const entityLabel = entityType === "expense" ? "Pengeluaran" : "Pemasukan";
  const operationIcon = mode === "edit" ? <Pencil className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />;
  const themeColor = mode === "edit" ? "warning" : "danger";

  return (
    <Modal
      open={open}
      onClose={
        submitting
          ? () => undefined
          : () => {
              resetAll();
              onClose();
            }
      }
      title={`Ajukan ${operationLabel} ${entityLabel}`}
      description={
        success
          ? "Kode terkirim ke Owner. Tunggu approve."
          : "Owner akan terima email berisi kode 6-digit untuk approve."
      }
      size="2xl"
      footer={
        success ? (
          <Button
            onClick={() => {
              resetAll();
              onClose();
            }}
            size="lg"
          >
            Tutup
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={!canSubmit || submitting}
              size="lg"
              className="!h-12"
            >
              <Mail className="size-4" /> Kirim ke Owner
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-mahakan-green-500 bg-mahakan-green-50 p-4 text-center">
            <p className="text-xs uppercase tracking-wider text-mahakan-green-900">
              Kode dimulai dengan
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-mahakan-green-900">
              {success.codeFirstTwo}**
            </p>
            <p className="mt-2 text-xs text-mahakan-green-900">
              Email lengkap dikirim ke {success.ownerEmailMasked}
            </p>
          </div>
          {success.emailMode === "failed" ? (
            <div className="rounded-md border border-danger-300 bg-danger-100 p-3 text-xs text-danger-700">
              <strong>Email gagal kirim.</strong> Minta Owner cek Pengaturan →
              Email Approval, atau forward kode lewat WhatsApp.
            </div>
          ) : null}
          <p className="text-xs text-neutral-600">
            Owner buka backoffice → Shifts → Pending Approvals → input kode
            untuk approve. Setelah approve, entry akan ter-update.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header context badge */}
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
              themeColor === "danger"
                ? "border-danger-300 bg-danger-50 text-danger-700"
                : "border-warning-300 bg-warning-50 text-warning-700",
            )}
          >
            {operationIcon}
            <span>
              <strong>{operationLabel}</strong> {entityLabel.toLowerCase()}:{" "}
              <span className="font-mono">
                Rp {formatRupiah(Number(entity.amount))}
              </span>{" "}
              · {entity.description || "(tanpa deskripsi)"}
            </span>
          </div>

          {/* Edit form (only for mode=edit) */}
          {mode === "edit" ? (
            <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3">
              <header>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                  Data Baru yang Diusulkan
                </h3>
                <p className="text-[10px] text-neutral-500">
                  Edit field yang salah. Yang tidak diubah biarkan sama.
                </p>
              </header>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <DatePicker
                    label="Tanggal"
                    value={dateValue}
                    onChange={(v) => v && setDateValue(v)}
                    size="md"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-neutral-700">
                    Nominal
                  </label>
                  <NumericInput
                    value={amountRaw}
                    onChange={setAmountRaw}
                    prefix="Rp"
                    formatThousands
                  />
                </div>
                {entityType === "expense" ? (
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-medium text-neutral-700">
                      Kategori
                    </label>
                    <select
                      value={categoryIdValue}
                      onChange={(e) => setCategoryIdValue(e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <Input
                    label="Deskripsi"
                    value={descriptionValue}
                    onChange={(e) => setDescriptionValue(e.target.value)}
                    placeholder="Deskripsi entry"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-neutral-700">
                    Metode
                  </label>
                  <select
                    value={paymentMethodValue}
                    onChange={(e) =>
                      setPaymentMethodValue(e.target.value as "cash" | "transfer" | "other")
                    }
                    className="mt-0.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
                  >
                    {PAYMENT_METHODS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Diff preview (live) */}
              {diff.length > 0 ? (
                <div className="rounded-md bg-mahakan-green-50 px-3 py-2 text-xs">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mahakan-green-900">
                    Perubahan yang Diusulkan
                  </p>
                  <ul className="space-y-1">
                    {diff.map((d) => (
                      <li key={d.label} className="flex flex-wrap items-baseline gap-2">
                        <span className="text-neutral-600">{d.label}:</span>
                        <span className="font-mono text-neutral-500 line-through">
                          {d.oldValue}
                        </span>
                        <span className="text-neutral-400">→</span>
                        <span className="font-mono font-semibold text-mahakan-green-900">
                          {d.newValue}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  Belum ada perubahan terdeteksi. Edit field di atas untuk lanjut.
                </p>
              )}
            </section>
          ) : (
            <div className="rounded-md border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
              <p className="font-medium">Entry akan dihapus (soft-delete)</p>
              <p className="mt-1 text-xs">
                Audit trail tetap tersimpan. Owner bisa unhide via tools admin
                kalau perlu rollback.
              </p>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <label
              htmlFor="entry-change-reason"
              className="flex items-baseline justify-between"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Alasan
                <span className="ml-1 text-danger-500" aria-hidden>
                  *
                </span>
              </span>
              <span
                className={cn(
                  "text-[10px]",
                  reason.trim().length < 3 ? "text-neutral-400" : "text-mahakan-green-700",
                )}
              >
                {reason.trim().length} / min 3 karakter
              </span>
            </label>
            <textarea
              id="entry-change-reason"
              rows={2}
              placeholder={
                mode === "edit"
                  ? "mis. salah ketik nominal, harusnya 27rb bukan 72rb"
                  : "mis. double input — entry duplikat, hapus satu"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
              required
            />
          </div>

          {/* Warning */}
          <div className="rounded-md border border-warning-300 bg-warning-100/70 p-3 text-xs text-warning-700">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong>Setelah Owner approve:</strong>{" "}
                {mode === "edit"
                  ? "entry akan ter-update sesuai data baru. Tercatat di audit log dengan reason + approver."
                  : "entry akan ter-hapus (soft-delete). Bisa di-restore manual oleh owner kalau perlu."}
              </span>
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100 p-2.5 text-sm font-medium text-danger-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
