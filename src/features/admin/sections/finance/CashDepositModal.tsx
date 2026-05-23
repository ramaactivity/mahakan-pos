"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileText, ImagePlus, Loader2, X } from "lucide-react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import {
  createCashDeposit,
  fetchCashDepositDashboard,
  updateCashDeposit,
} from "@/features/finance/actions";
import type { CashDeposit } from "@/features/finance/types";
import {
  BankAccountSelect,
  FREE_TEXT_VALUE,
} from "@/features/bank-accounts/BankAccountSelect";
import { formatBankAccountDisplay } from "@/features/bank-accounts/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, opens in edit mode (only pending deposits editable). */
  editing?: CashDeposit | null;
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* Sesi AE-123 — localStorage draft autosave. Owner request: kalau modal
 * ke-close accidentally (refresh tab, dll), input tidak hilang.
 *
 * Storage key per outlet supaya draft cross-outlet tidak bocor. Photo URL
 * tidak di-save (transient asset, re-upload simpler). Edit mode tidak
 * pakai draft (sumber data dari row, draft cuma untuk create). */
const DRAFT_STORAGE_KEY = "mahakan:cash-deposit-draft:v1";

interface DraftPayload {
  depositDate: string | null;
  amount: string;
  bankDestination: string;
  accountSelectId: string | null;
  referenceNo: string;
  notes: string;
  coversFromDate: string | null;
  coversToDate: string | null;
  savedAt: number;
}

function loadDraft(): DraftPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    /* Drop draft > 24 jam (stale, kemungkinan owner sudah lupa). */
    if (Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(payload: Omit<DraftPayload, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ ...payload, savedAt: Date.now() }),
    );
  } catch {
    /* localStorage might be full/disabled — silently skip. */
  }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isDraftMeaningful(d: DraftPayload | null): boolean {
  if (!d) return false;
  return (
    d.amount !== "" ||
    d.bankDestination.trim() !== "" ||
    d.referenceNo.trim() !== "" ||
    d.notes.trim() !== ""
  );
}

/**
 * Sesi AE-8 redesign — Catat Setoran Tunai with integrated upload + smart
 * defaults. Replaces old URL-paste field dengan proper Drive upload (clone
 * pattern dari PurchaseFormModal). Auto-suggest amount = cashOnHand &
 * periode = since last verified.
 */
export function CashDepositModal({ open, onClose, onSaved, editing }: Props) {
  const [depositDate, setDepositDate] = useState<string | null>(todayIso());
  const [amount, setAmount] = useState("");
  const [bankDestination, setBankDestination] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [coversFromDate, setCoversFromDate] = useState<string | null>(
    todayIso(),
  );
  const [coversToDate, setCoversToDate] = useState<string | null>(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Smart defaults — only fetched on open create-mode (not edit).
  const [cashOnHand, setCashOnHand] = useState<number | null>(null);
  // Sesi AE-13 — bank account selector. accountSelectId = "id" / FREE_TEXT_VALUE / null
  // bankDestination remains the saved string (formatted display from account
  // ATAU free-text yang user ketik manual).
  const [accountSelectId, setAccountSelectId] = useState<string | null>(null);
  /* Sesi AE-123 — draft restoration prompt state. */
  const [pendingDraft, setPendingDraft] = useState<DraftPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setSubmitting(false);
    if (editing) {
      setDepositDate(editing.depositDate);
      setAmount(String(editing.amount));
      setBankDestination(editing.bankDestination);
      setAccountSelectId(FREE_TEXT_VALUE); // edit mode: assume free-text
      setReferenceNo(editing.referenceNo ?? "");
      setPhotoUrl(editing.photoUrl ?? null);
      setPhotoFileName(editing.photoUrl ? "Bukti tersimpan" : null);
      setNotes(editing.notes ?? "");
      setCoversFromDate(editing.coversFromDate);
      setCoversToDate(editing.coversToDate);
      setPendingDraft(null);
    } else {
      const t = todayIso();
      setDepositDate(t);
      setAmount("");
      setBankDestination("");
      setAccountSelectId(null);
      setReferenceNo("");
      setPhotoUrl(null);
      setPhotoFileName(null);
      setNotes("");
      setCoversFromDate(t);
      setCoversToDate(t);
      /* Sesi AE-123 — check draft autosave. Kalau ada draft meaningful,
       * tampilkan prompt restore (banner di atas form). User pilih restore
       * atau diskard via tombol "Hapus draft". */
      const draft = loadDraft();
      setPendingDraft(isDraftMeaningful(draft) ? draft : null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editing]);

  /* Sesi AE-123 — autosave draft saat user ngetik (debounced 500ms).
   * Hanya untuk create mode (edit mode pakai row data, tidak butuh draft). */
  useEffect(() => {
    if (!open || editing) return;
    const handle = window.setTimeout(() => {
      const payload = {
        depositDate,
        amount,
        bankDestination,
        accountSelectId,
        referenceNo,
        notes,
        coversFromDate,
        coversToDate,
      };
      /* Skip save kalau semua field default (no need to clutter storage). */
      if (
        amount === "" &&
        bankDestination.trim() === "" &&
        referenceNo.trim() === "" &&
        notes.trim() === ""
      ) {
        return;
      }
      saveDraft(payload);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    open,
    editing,
    depositDate,
    amount,
    bankDestination,
    accountSelectId,
    referenceNo,
    notes,
    coversFromDate,
    coversToDate,
  ]);

  function applyDraft(d: DraftPayload) {
    setDepositDate(d.depositDate);
    setAmount(d.amount);
    setBankDestination(d.bankDestination);
    setAccountSelectId(d.accountSelectId);
    setReferenceNo(d.referenceNo);
    setNotes(d.notes);
    setCoversFromDate(d.coversFromDate);
    setCoversToDate(d.coversToDate);
    setPendingDraft(null);
  }

  function discardDraft() {
    clearDraft();
    setPendingDraft(null);
  }

  // Smart defaults effect — separate so it doesn't reset user inputs.
  useEffect(() => {
    if (!open || editing) return;
    let cancelled = false;
    void (async () => {
      const dashRes = await fetchCashDepositDashboard();
      if (cancelled) return;
      if (dashRes.ok) {
        const onHand = dashRes.data.outstandingToDeposit;
        setCashOnHand(onHand);
        // Pre-fill amount = outstanding cash (rounded to nearest 1000).
        if (onHand > 0) {
          setAmount(String(Math.round(onHand)));
        }
        // Pre-fill periode: from (lastVerified.coversToDate + 1) to today.
        if (dashRes.data.lastVerified) {
          setCoversFromDate(addOneDay(dashRes.data.lastVerified.depositDate));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const exceedsCashOnHand =
    cashOnHand !== null && parsedAmount > cashOnHand && cashOnHand > 0;

  async function handlePhotoPick(file: File) {
    if (!depositDate) {
      toast.error("Pilih tanggal setor dulu sebelum upload");
      return;
    }
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Ukuran maks 5 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("depositDate", depositDate);
      const res = await fetch("/api/v1/setoran-receipts/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { success: true; data: { url: string; folderPath: string } }
        | { success: false; error: { code: string; message: string } };
      if (!json.success) throw new Error(json.error.message);
      setPhotoUrl(json.data.url);
      setPhotoFileName(file.name);
      toast.success(`Bukti tersimpan di Drive · ${json.data.folderPath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload gagal");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onSubmit() {
    setError(null);
    if (!depositDate || !coversFromDate || !coversToDate) {
      setError("Tanggal wajib diisi");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Nominal harus lebih dari 0");
      return;
    }
    if (bankDestination.trim().length < 2) {
      setError("Tujuan bank wajib diisi");
      return;
    }
    if (coversToDate < coversFromDate) {
      setError("Periode akhir harus >= awal");
      return;
    }
    // Foto wajib saat create (anti-fraud sesi AE-8). Edit boleh tanpa
    // foto karena auto-create dari shift close mungkin masih kosong;
    // verify side enforce required at approve time.
    if (!editing && !photoUrl) {
      setError(
        "Foto bukti transfer / nota wajib di-upload sebelum simpan",
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        depositDate,
        amount: parsedAmount,
        bankDestination: bankDestination.trim(),
        referenceNo: referenceNo.trim() || null,
        photoUrl: photoUrl || null,
        notes: notes.trim() || null,
        coversFromDate,
        coversToDate,
      };
      const res = editing
        ? await updateCashDeposit({ id: editing.id, ...payload })
        : await createCashDeposit(payload);
      if (res.ok) {
        /* Sesi AE-123 — clear draft autosave saat submit sukses. */
        if (!editing) clearDraft();
        toast.success(editing ? "Setoran diupdate" : "Setoran dicatat");
        onSaved();
      } else {
        setError(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={editing ? "Edit Setoran Tunai" : "Catat Setoran Tunai"}
      description={
        editing
          ? "Update setoran pending. Foto bukti wajib sebelum di-verifikasi owner."
          : "Catat setoran cash ke bank atau owner. Foto bukti transfer/nota wajib supaya owner bisa verifikasi."
      }
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={uploading}
            size="lg"
          >
            {editing ? "Update Setoran" : "Simpan Setoran"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Sesi AE-123 — draft autosave restore banner (create only). Muncul
         * kalau ada draft di localStorage yang belum di-submit (mis. modal
         * ke-close accidental, refresh tab). User pilih restore atau diskard. */}
        {!editing && pendingDraft ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-info-300 bg-info-50 px-3 py-2 text-sm">
            <div className="flex-1">
              <p className="font-medium text-info-700">
                Ada draft setoran sebelumnya
              </p>
              <p className="text-[11px] text-neutral-600">
                Tersimpan{" "}
                {new Date(pendingDraft.savedAt).toLocaleString("id-ID", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                ·{" "}
                {pendingDraft.amount
                  ? formatRupiah(Number(pendingDraft.amount))
                  : "—"}
                {pendingDraft.bankDestination
                  ? ` → ${pendingDraft.bankDestination}`
                  : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={discardDraft}
                aria-label="Buang draft"
              >
                Buang
              </Button>
              <Button size="sm" onClick={() => applyDraft(pendingDraft)}>
                Restore
              </Button>
            </div>
          </div>
        ) : null}

        {/* Cash on hand context (create only) */}
        {!editing && cashOnHand !== null ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              cashOnHand > 0
                ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
                : "border-neutral-200 bg-neutral-50 text-neutral-700",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span>
                <strong>Kas siap setor:</strong>{" "}
                <span className="font-mono">{formatRupiah(cashOnHand)}</span>
              </span>
              {cashOnHand > 0 ? (
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.round(cashOnHand)))}
                  className="rounded-md bg-mahakan-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-mahakan-green-800"
                >
                  Setor Semua
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-neutral-600">
              Angka ini = penjualan tunai − pengeluaran − setoran terverifikasi
              (dari shift yang sudah ditutup). <strong>Petty cash di laci</strong> tidak
              termasuk — itu sisa float harian yang tetap di kasir.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <DatePicker
            label="Tanggal Setor"
            value={depositDate}
            onChange={setDepositDate}
            required
          />
          <NumericInput
            label="Nominal"
            value={amount}
            onChange={setAmount}
            prefix="Rp"
            formatThousands
            required
          />
        </div>

        {exceedsCashOnHand ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-100 p-2 text-xs text-warning-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Nominal ({formatRupiah(parsedAmount)}) lebih besar dari kas
              tersedia ({formatRupiah(cashOnHand ?? 0)}). Pastikan jumlah benar
              sebelum submit.
            </span>
          </div>
        ) : null}

        <div className="space-y-2">
          <BankAccountSelect
            label="Tujuan Setoran"
            value={accountSelectId}
            onChange={(id, account) => {
              setAccountSelectId(id);
              if (id === FREE_TEXT_VALUE) {
                setBankDestination("");
              } else if (account) {
                setBankDestination(formatBankAccountDisplay(account));
              } else {
                setBankDestination("");
              }
            }}
            allowFreeText
            required
            hint="Pilih dari daftar rekening yang sudah terdaftar di Pengaturan."
          />
          {accountSelectId === FREE_TEXT_VALUE ? (
            <Input
              label="Tujuan (manual)"
              placeholder="BCA — Owner 1234567890"
              value={bankDestination}
              onChange={(e) => setBankDestination(e.target.value)}
              required
              hint="Free-text untuk rekening yang belum di-register. Tambah ke Pengaturan supaya bisa di-pilih dropdown lain kali."
            />
          ) : null}
        </div>

        <Input
          label="No. Referensi (opsional)"
          placeholder="Slip / m-banking ref"
          value={referenceNo}
          onChange={(e) => setReferenceNo(e.target.value)}
          hint="Nomor slip / referensi transfer m-banking. Optional."
        />

        {/* Photo upload — Drive integration (clone PurchaseFormModal pattern) */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Foto Bukti Transfer / Nota{" "}
            {!editing ? (
              <span className="text-danger-500" aria-hidden>
                *
              </span>
            ) : null}
          </label>
          {photoUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center gap-2 text-xs text-mahakan-green-900 hover:underline min-w-0"
              >
                <FileText className="size-4 shrink-0" />
                <span className="truncate">
                  {photoFileName ?? "Lihat di Google Drive"}
                </span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setPhotoUrl(null);
                  setPhotoFileName(null);
                }}
                disabled={submitting || uploading}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                aria-label="Hapus bukti dari form (file tetap di Drive)"
                title="Hapus dari form"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePhotoPick(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || submitting}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <ImagePlus className="size-4" /> Upload Foto / PDF
                  </>
                )}
              </Button>
              <p className="mt-1 text-xs text-neutral-500">
                JPG / PNG / WebP / PDF, max 5 MB. Tersimpan otomatis di Google
                Drive folder <strong>BUKTI SETORAN</strong> → tahun → bulan.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label="Periode Kas (Dari)"
            value={coversFromDate}
            onChange={setCoversFromDate}
            required
            hint="Tanggal awal kas yang ditutupi setoran"
          />
          <DatePicker
            label="Periode Kas (Sampai)"
            value={coversToDate}
            onChange={setCoversToDate}
            required
          />
        </div>

        <Input
          label="Catatan (opsional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Misal: setor 2 hari sekaligus, sisa di drawer Rp 100k"
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
