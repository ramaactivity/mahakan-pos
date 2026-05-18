"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  toast,
  type ComboboxOption,
} from "@/components/ui";
import {
  fetchAccounts,
  saveManualJournal,
  updateDraftJournalEntry,
} from "@/features/accounting/actions";
import type {
  AccountListRow,
  JournalEntryWithLines,
} from "@/features/accounting/types";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Owner can post directly. Manager can save as draft. */
  isOwner: boolean;
  /** Sesi AE-63 phase4 — kalau di-set, modal berjalan di edit mode.
   * Pre-fill date/description/lines dari draft. Pada save, panggil
   * updateDraftJournalEntry (entryId stable, no new entry number). */
  editEntry?: JournalEntryWithLines | null;
}

type LineDraft = {
  id: string;
  accountId: string | null;
  debit: string; // numeric input string
  credit: string;
  description: string;
};

function blankLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountId: null,
    debit: "0",
    credit: "0",
    description: "",
  };
}

export function JournalEntryModal({
  open,
  onClose,
  onSaved,
  isOwner,
  editEntry,
}: Props) {
  const isEdit = editEntry != null;
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (editEntry) {
      /* Pre-fill from existing draft. entryDate dari DB kemungkinan
       * sudah YYYY-MM-DD string atau Date — coerce ke string. */
      const dateStr =
        typeof editEntry.entryDate === "string"
          ? editEntry.entryDate
          : new Date(editEntry.entryDate).toISOString().slice(0, 10);
      setEntryDate(dateStr);
      setDescription(editEntry.description);
      setLines(
        editEntry.lines.length >= 2
          ? editEntry.lines.map((l) => ({
              id: l.id,
              accountId: l.accountId,
              debit: String(Number(l.debit) || 0),
              credit: String(Number(l.credit) || 0),
              description: l.description ?? "",
            }))
          : [blankLine(), blankLine()],
      );
    } else {
      setEntryDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setLines([blankLine(), blankLine()]);
    }
    setError(null);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchAccounts({ isActive: true })
      .then((res) => {
        if (res.ok) setAccounts(res.data);
        else toast.error(res.error.message);
      })
      .finally(() => setLoading(false));
  }, [open, editEntry]);

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.id,
        label: `${a.code} ${a.name}`,
        hint: a.type,
      })),
    [accounts],
  );

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += Number(l.debit) || 0;
      cr += Number(l.credit) || 0;
    }
    return { dr, cr, diff: dr - cr };
  }, [lines]);
  const balanced = totals.dr > 0 && totals.diff === 0;

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));
  }

  async function submit(status: "draft" | "posted") {
    if (submitting) return;
    setError(null);

    if (!entryDate) {
      setError("Tanggal wajib diisi");
      return;
    }
    if (description.trim().length < 3) {
      setError("Deskripsi minimal 3 karakter");
      return;
    }
    const validLines = lines.filter(
      (l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0),
    );
    if (validLines.length < 2) {
      setError("Minimal 2 baris valid");
      return;
    }
    for (const l of validLines) {
      const dr = Number(l.debit);
      const cr = Number(l.credit);
      if ((dr > 0 && cr > 0) || (dr === 0 && cr === 0)) {
        setError("Setiap baris harus debit ATAU credit, bukan keduanya");
        return;
      }
    }
    if (!balanced) {
      setError(
        `Belum balance — selisih ${formatRupiah(Math.abs(totals.diff))}`,
      );
      return;
    }

    setSubmitting(true);
    const inputLines = validLines.map((l) => ({
      accountId: l.accountId!,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description.trim() || null,
    }));
    const res = isEdit
      ? await updateDraftJournalEntry({
          entryId: editEntry!.id,
          entryDate,
          description: description.trim(),
          newStatus: status,
          lines: inputLines,
        })
      : await saveManualJournal({
          entryDate,
          description: description.trim(),
          status,
          lines: inputLines,
        });
    setSubmitting(false);

    if (res.ok) {
      toast.success(
        isEdit
          ? status === "posted"
            ? `Entry ${res.data.entryNumber} ter-edit + ter-post`
            : `Draft ${res.data.entryNumber} ter-update`
          : status === "draft"
            ? `Draft ${res.data.entryNumber} disimpan`
            : `Entry ${res.data.entryNumber} terposting`,
      );
      onSaved();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Draft ${editEntry!.entryNumber}` : "Entry Jurnal Manual"}
      description={
        isEdit
          ? "Edit draft entry. Save changes sebagai draft, atau post langsung (Owner) sekalian."
          : isOwner
            ? "Owner: post langsung atau save as draft. Reverse via Jurnal tab kalau perlu."
            : "Manager: save as draft. Owner approve + post via Jurnal tab."
      }
      size="3xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-mono text-neutral-500">
              Dr {formatRupiah(totals.dr)} · Cr {formatRupiah(totals.cr)}
            </span>
            {balanced ? (
              <span className="ml-2 inline-flex items-center gap-1 text-success-500">
                <CheckCircle2 className="size-4" /> Balance
              </span>
            ) : totals.dr === 0 ? (
              <span className="ml-2 text-xs text-neutral-500">
                Isi minimal 2 baris
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 text-warning-500">
                <AlertCircle className="size-4" /> Selisih{" "}
                {formatRupiah(Math.abs(totals.diff))}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              variant="outline"
              onClick={() => submit("draft")}
              disabled={submitting}
            >
              Save Draft
            </Button>
            {isOwner ? (
              <Button
                onClick={() => submit("posted")}
                loading={submitting}
                disabled={submitting || !balanced}
              >
                Post Entry
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Tanggal Entry"
            value={entryDate}
            onChange={setEntryDate}
          />
          <Input
            label="Deskripsi"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="contoh: Adjust stock raw bean Mei"
            maxLength={200}
          />
        </div>

        <div className="rounded-md border border-neutral-200">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="w-1/3 px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Akun
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Debit
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Credit
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Catatan
                </th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-2 py-1.5 align-top">
                    <Combobox
                      hideLabel
                      ariaLabel="Pilih akun"
                      options={accountOptions}
                      value={line.accountId}
                      onChange={(v) => updateLine(line.id, { accountId: v })}
                      placeholder="— pilih akun —"
                      loading={loading}
                      size="sm"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <NumericInput
                      ariaLabel="Debit"
                      value={line.debit}
                      onChange={(v) => updateLine(line.id, { debit: v })}
                      prefix="Rp"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <NumericInput
                      ariaLabel="Credit"
                      value={line.credit}
                      onChange={(v) => updateLine(line.id, { credit: v })}
                      prefix="Rp"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <Input
                      placeholder="opsional"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(line.id, { description: e.target.value })
                      }
                      maxLength={200}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length <= 2}
                      className={cn(
                        "rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-danger-500",
                        lines.length <= 2 && "cursor-not-allowed opacity-30",
                      )}
                      aria-label="Hapus baris"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-neutral-100 p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={addLine}
            >
              <Plus className="size-4" /> Tambah Baris
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-500">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
