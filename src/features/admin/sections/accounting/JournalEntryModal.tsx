"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import {
  Badge,
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
  AccountType,
  JournalEntryWithLines,
  NormalBalance,
} from "@/features/accounting/types";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

/* Sesi AE-72 — UX helper: format akun type untuk badge label. */
function formatAccountTypeLabel(type: AccountType): string {
  switch (type) {
    case "asset":
      return "Aset";
    case "liability":
      return "Liabilitas";
    case "equity":
      return "Ekuitas";
    case "revenue":
      return "Pendapatan";
    case "cogs":
      return "HPP";
    case "expense":
      return "Beban";
    default:
      return type;
  }
}

function accountTypeBadgeVariant(
  type: AccountType,
): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (type) {
    case "asset":
      return "success";
    case "liability":
      return "warning";
    case "equity":
      return "info";
    case "revenue":
      return "success";
    case "cogs":
    case "expense":
      return "danger";
    default:
      return "neutral";
  }
}

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
        label: `${a.code} — ${a.name}`,
        hint: `${formatAccountTypeLabel(a.type as AccountType)} · Normal ${a.normalBalance === "debit" ? "DR" : "CR"}`,
        keywords: [a.code, a.name, a.type],
      })),
    [accounts],
  );

  /* Sesi AE-72 — Lookup map untuk fetch metadata akun saat user pilih.
   * Dipakai render per-row badge + auto-clear opposite Dr/Cr field. */
  const accountById = useMemo(() => {
    const m = new Map<string, AccountListRow>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

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
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        /* Sesi AE-72 — Smart Dr/Cr exclusivity:
         * Setiap baris hanya boleh Dr ATAU Cr, tidak keduanya. Saat user
         * isi salah satu > 0, otomatis clear yang sebaliknya supaya
         * tidak accidentally double-input + tidak perlu manual reset. */
        if (patch.debit !== undefined && Number(patch.debit) > 0) {
          next.credit = "0";
        }
        if (patch.credit !== undefined && Number(patch.credit) > 0) {
          next.debit = "0";
        }
        return next;
      }),
    );
  }

  /* Sesi AE-72 — Quick templates: preset 1-tap untuk pola umum.
   * Setelah dipick, modal pre-fill description + 2 lines dengan akun yang
   * masuk akal. Owner masih harus isi nominal + edit akhir sebelum post. */
  type Template = {
    key: string;
    label: string;
    description: string;
    lineDebitCode: string;
    lineCreditCode: string;
  };
  const TEMPLATES: Template[] = [
    {
      key: "saldo-bank",
      label: "Saldo Awal Bank",
      description: "Penyesuaian Saldo Awal Bank ",
      lineDebitCode: "1110",
      lineCreditCode: "3101",
    },
    {
      key: "saldo-kas",
      label: "Saldo Awal Kas",
      description: "Penyesuaian Saldo Awal Kas",
      lineDebitCode: "1101",
      lineCreditCode: "3101",
    },
    {
      key: "owner-suntik",
      label: "Suntik Modal Owner",
      description: "Setoran modal owner ",
      lineDebitCode: "1110",
      lineCreditCode: "3101",
    },
  ];
  function applyTemplate(t: Template) {
    const findId = (code: string) => accounts.find((a) => a.code === code)?.id ?? null;
    setDescription(t.description);
    setLines([
      {
        id: crypto.randomUUID(),
        accountId: findId(t.lineDebitCode),
        debit: "0",
        credit: "0",
        description: "",
      },
      {
        id: crypto.randomUUID(),
        accountId: findId(t.lineCreditCode),
        debit: "0",
        credit: "0",
        description: "",
      },
    ]);
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
        {/* Sesi AE-72 — Quick templates. Hanya tampil di mode CREATE, bukan
         * edit (edit pre-fill dari existing entry). */}
        {!isEdit ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs">
            <Sparkles className="size-3.5 text-mahakan-green-700" aria-hidden />
            <span className="font-medium text-neutral-700">
              Quick Template:
            </span>
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-mahakan-green-500 hover:bg-mahakan-green-50 hover:text-mahakan-green-900"
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

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
              {lines.map((line) => {
                /* Sesi AE-72 — pre-resolve account untuk badge + smart
                 * highlight Dr/Cr cell sesuai normalBalance. */
                const acc = line.accountId ? accountById.get(line.accountId) : null;
                const normalBalance: NormalBalance | null = acc?.normalBalance ?? null;
                const dr = Number(line.debit) || 0;
                const cr = Number(line.credit) || 0;
                /* Detect "abnormal posting" warning: kalau owner isi sisi
                 * yang tidak sesuai normal balance akun. Bukan blocker
                 * (kadang valid: contra entry), cuma soft warning. */
                const abnormal =
                  acc &&
                  ((normalBalance === "debit" && cr > 0 && dr === 0) ||
                    (normalBalance === "credit" && dr > 0 && cr === 0));
                return (
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
                      {acc ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge
                            variant={accountTypeBadgeVariant(acc.type as AccountType)}
                            className="!text-[9px]"
                          >
                            {formatAccountTypeLabel(acc.type as AccountType)}
                          </Badge>
                          <span className="text-[9px] uppercase tracking-wide text-neutral-500">
                            Normal{" "}
                            <span className="font-semibold text-neutral-700">
                              {normalBalance === "debit" ? "DR" : "CR"}
                            </span>
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 align-top",
                        normalBalance === "debit" &&
                          "bg-mahakan-green-50/40",
                      )}
                    >
                      <NumericInput
                        ariaLabel="Debit"
                        value={line.debit}
                        onChange={(v) => updateLine(line.id, { debit: v })}
                        prefix="Rp"
                      />
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 align-top",
                        normalBalance === "credit" &&
                          "bg-mahakan-green-50/40",
                      )}
                    >
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
                      {abnormal ? (
                        <p className="mt-1 text-[10px] text-warning-700">
                          ⚠ Posisi tidak biasa untuk akun{" "}
                          {formatAccountTypeLabel(acc!.type as AccountType)}
                          {" "}(normal {normalBalance === "debit" ? "DR" : "CR"}).
                          Pastikan benar — biasanya valid hanya untuk contra
                          entry / koreksi.
                        </p>
                      ) : null}
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
                );
              })}
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
