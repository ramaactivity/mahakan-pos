"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Upload,
} from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  bulkImportPengelola,
  isOk,
  type BulkImportPengelolaRow,
  type PengelolaStatus,
} from "@/features/pengelola";
import { formatRupiah } from "@/lib/format";
import {
  downloadCsv,
  findHeaderIdx,
  parseCsv,
  parseDateCell,
  parseRupiahCell,
  rowsToCsv,
} from "./_csv-utils";

/**
 * Sesi AE-80 follow-up — CSV import wizard untuk pengelola (5 manager).
 * Mirror pattern InvestorImportWizard tapi tanpa sharePct (pengelola pool
 * split by modal proportional, bukan share % manual).
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = "upload" | "preview" | "result";

interface ParsedRow extends BulkImportPengelolaRow {
  rawRowNum: number;
}

interface ImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}

type ImportMode = "insert_only" | "upsert";

function parseStatus(s: string): PengelolaStatus | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "active" || v === "aktif") return "active";
  if (v === "inactive" || v === "non-aktif") return "inactive";
  if (v === "exited" || v === "keluar") return "exited";
  return undefined;
}

function mapRow(
  row: string[],
  idx: {
    name: number;
    nik: number;
    email: number;
    phone: number;
    address: number;
    dob: number;
    bank: number;
    accountNumber: number;
    accountHolder: number;
    modal: number;
    dividendBalance: number;
    status: number;
  },
  rowNum: number,
): { ok: true; row: ParsedRow } | { ok: false; reason: string } {
  const get = (i: number) => (i >= 0 && i < row.length ? row[i] : "");
  const fullName = get(idx.name).trim();
  if (!fullName || fullName.length < 2) {
    return { ok: false, reason: "Nama kosong / terlalu pendek" };
  }
  const modal = parseRupiahCell(get(idx.modal));
  const balance =
    idx.dividendBalance >= 0 ? parseRupiahCell(get(idx.dividendBalance)) : null;
  const status = idx.status >= 0 ? parseStatus(get(idx.status)) : undefined;
  if (idx.status >= 0 && get(idx.status).trim() && !status) {
    return {
      ok: false,
      reason: `Status tidak dikenal "${get(idx.status)}"`,
    };
  }
  return {
    ok: true,
    row: {
      rawRowNum: rowNum,
      fullName,
      nickname: null,
      nik: get(idx.nik).trim() || null,
      email: get(idx.email).trim() || null,
      phone: get(idx.phone).replace(/^'/, "").trim() || null,
      address: get(idx.address).trim() || null,
      dateOfBirth: parseDateCell(get(idx.dob)),
      bankName: get(idx.bank).trim() || null,
      bankAccountNumber: get(idx.accountNumber).trim() || null,
      bankAccountHolderName: get(idx.accountHolder).trim() || null,
      modalDisetor: modal,
      dividendBalance: balance,
      status,
    },
  };
}

export function PengelolaImportWizard({ open, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [mode, setMode] = useState<ImportMode>("insert_only");

  const parsed = useMemo(() => {
    if (!csvText)
      return {
        parsedRows: [] as ParsedRow[],
        parseErrors: [] as { row: number; reason: string }[],
      };
    const { headers, rows } = parseCsv(csvText);
    const idx = {
      name: findHeaderIdx(headers, ["nama lengkap", "nama"]),
      nik: findHeaderIdx(headers, ["nik"]),
      email: findHeaderIdx(headers, ["email"]),
      phone: findHeaderIdx(headers, ["telefon", "telp", "hp", "phone"]),
      address: findHeaderIdx(headers, ["alamat"]),
      dob: findHeaderIdx(headers, ["tanggal lahir", "dob"]),
      bank: findHeaderIdx(headers, ["bank"]),
      accountNumber: findHeaderIdx(headers, ["no rekening", "rekening"]),
      accountHolder: findHeaderIdx(headers, ["atas nama"]),
      modal: findHeaderIdx(headers, ["modal disetor", "modal"]),
      dividendBalance: findHeaderIdx(headers, ["saldo dividen", "dividen"]),
      status: findHeaderIdx(headers, ["status"]),
    };
    if (idx.name < 0 || idx.modal < 0) {
      return {
        parsedRows: [],
        parseErrors: [
          {
            row: 0,
            reason: 'CSV harus punya kolom "Nama Lengkap" + "Modal Disetor"',
          },
        ],
      };
    }
    const parsedRows: ParsedRow[] = [];
    const parseErrors: { row: number; reason: string }[] = [];
    rows.forEach((row, i) => {
      const r = mapRow(row, idx, i + 2);
      if (r.ok) parsedRows.push(r.row);
      else parseErrors.push({ row: i + 2, reason: r.reason });
    });
    return { parsedRows, parseErrors };
  }, [csvText]);

  async function handleFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setStep("preview");
  }

  async function handleConfirm() {
    if (submitting) return;
    if (parsed.parsedRows.length === 0) {
      toast.error("Tidak ada baris valid");
      return;
    }
    setSubmitting(true);
    const res = await bulkImportPengelola({
      mode,
      rows: parsed.parsedRows.map((r) => ({
        fullName: r.fullName,
        nickname: r.nickname ?? null,
        nik: r.nik ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        dateOfBirth: r.dateOfBirth ?? null,
        bankName: r.bankName ?? null,
        bankAccountNumber: r.bankAccountNumber ?? null,
        bankAccountHolderName: r.bankAccountHolderName ?? null,
        modalDisetor: r.modalDisetor,
        dividendBalance: r.dividendBalance ?? null,
        status: r.status,
      })),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setResult(res.data);
    setStep("result");
    onImported();
  }

  function handleClose() {
    setCsvText("");
    setStep("upload");
    setResult(null);
    onClose();
  }

  function handleDownloadTemplate() {
    const headers = [
      "Nama Lengkap",
      "NIK",
      "Email",
      "Telefon",
      "Alamat",
      "Tanggal Lahir",
      "Bank",
      "No Rekening",
      "Atas Nama",
      "Modal Disetor",
      "Saldo Dividen",
      "Status",
    ];
    const sample: (string | number)[][] = [
      [
        "Anisa Amalia",
        "",
        "anisa@mahakan.com",
        "+6281234567890",
        "Jl. Mawar No. 1, Bogor",
        "1998-03-15",
        "BCA",
        "1234567890",
        "Anisa Amalia",
        1700000,
        "",
        "active",
      ],
      [
        "Muhamad Sekal Maulidan",
        "",
        "",
        "+6281234567891",
        "",
        "1996-08-20",
        "BRI",
        "624101014994534",
        "Sekal Maulidan",
        3500000,
        500000,
        "active",
      ],
    ];
    downloadCsv(
      "template-import-pengelola-mahakan.csv",
      rowsToCsv(headers, sample),
    );
    toast.success("Template CSV ter-download");
  }

  const totalModal = parsed.parsedRows.reduce((s, r) => s + r.modalDisetor, 0);
  const totalBalance = parsed.parsedRows.reduce(
    (s, r) => s + (r.dividendBalance ?? 0),
    0,
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Pengelola dari CSV"
      description="Bulk import 5 pengelola Mahakan Coffee."
      size="xl"
      footer={
        step === "result" ? (
          <Button onClick={handleClose}>Selesai</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>
              Batal
            </Button>
            {step === "preview" ? (
              <Button
                onClick={handleConfirm}
                loading={submitting}
                disabled={parsed.parsedRows.length === 0}
              >
                Import {parsed.parsedRows.length} Pengelola
              </Button>
            ) : null}
          </>
        )
      }
    >
      {step === "upload" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-mahakan-green-700/30 bg-gradient-to-br from-mahakan-green-50 to-white p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-mahakan-green-100 p-2">
                <FileText className="size-4 text-mahakan-green-700" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-mahakan-green-900">
                  Belum punya CSV?
                </h4>
                <p className="mt-0.5 text-xs text-neutral-700">
                  Download template dengan kolom yang sudah benar.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
              >
                <Download className="mr-1.5 size-4" /> Template
              </Button>
            </div>
          </div>

          <div className="rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
            <Upload className="mx-auto size-8 text-neutral-400" />
            <p className="mt-2 text-sm font-medium text-neutral-700">
              Pilih file CSV (max 100 baris)
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Auto-detect kolom: Nama Lengkap, NIK, Email, Telefon, Alamat,
              Tanggal Lahir, Bank, No Rekening, Atas Nama, Modal Disetor.
              <b>Optional:</b> Saldo Dividen, Status.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="mt-3 block w-full cursor-pointer rounded-md border border-neutral-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-mahakan-green-100 file:px-3 file:py-1 file:text-mahakan-green-900 hover:bg-neutral-100"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="mb-1 font-semibold">💡 Anti-duplikat</p>
              <p>Auto-skip kalau nama pengelola sudah ada (case-insensitive).</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-1 font-semibold">⚠️ Saldo Dividen</p>
              <p>
                Saldo dividen replace nilai existing + trail capital_movement
                adjustment dengan delta.
              </p>
            </div>
          </div>
        </div>
      ) : step === "preview" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">
              {parsed.parsedRows.length} baris valid
            </span>
            {parsed.parseErrors.length > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                {parsed.parseErrors.length} baris error
              </span>
            ) : null}
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
              Total modal: {formatRupiah(totalModal)}
            </span>
            {totalBalance > 0 ? (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">
                Total saldo dividen: {formatRupiah(totalBalance)}
              </span>
            ) : null}
          </div>

          <fieldset className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <legend className="px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
              Mode Import
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border-2 p-3 text-xs transition ${
                  mode === "insert_only"
                    ? "border-mahakan-green-500 bg-white"
                    : "border-neutral-200 bg-white/50 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="mode-pengelola"
                  value="insert_only"
                  checked={mode === "insert_only"}
                  onChange={() => setMode("insert_only")}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold text-neutral-900">
                    Tambah Saja
                  </span>
                  <span className="mt-0.5 block text-[11px] text-neutral-600">
                    Skip kalau nama sudah ada.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border-2 p-3 text-xs transition ${
                  mode === "upsert"
                    ? "border-mahakan-green-500 bg-white"
                    : "border-neutral-200 bg-white/50 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="mode-pengelola"
                  value="upsert"
                  checked={mode === "upsert"}
                  onChange={() => setMode("upsert")}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold text-neutral-900">
                    Tambah / Update (Upsert)
                  </span>
                  <span className="mt-0.5 block text-[11px] text-neutral-600">
                    Kalau nama sudah ada → update field-nya. Cocok untuk
                    update saldo dividen seed.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {parsed.parseErrors.length > 0 ? (
            <div className="max-h-32 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-semibold text-amber-900">
                <AlertTriangle className="inline size-3.5" /> Baris bermasalah:
              </p>
              <ul className="space-y-1 text-xs text-amber-800">
                {parsed.parseErrors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    Baris {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="px-2 py-1.5">No</th>
                  <th className="px-2 py-1.5">Nama</th>
                  <th className="px-2 py-1.5 text-right">Modal</th>
                  <th className="px-2 py-1.5 text-right">Saldo Dividen</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Bank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {parsed.parsedRows.slice(0, 10).map((r) => (
                  <tr key={r.rawRowNum}>
                    <td className="px-2 py-1">{r.rawRowNum}</td>
                    <td className="px-2 py-1 font-medium">{r.fullName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatRupiah(r.modalDisetor)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {r.dividendBalance != null && r.dividendBalance > 0
                        ? formatRupiah(r.dividendBalance)
                        : "—"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.status ?? "active"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.bankName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        result && (
          <div className="space-y-3">
            <div className="rounded-md bg-emerald-50 p-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
              <p className="mt-2 text-base font-semibold text-emerald-900">
                Import selesai
              </p>
              <p className="text-xs text-emerald-800">
                {result.inserted} baru
                {result.updated > 0 ? ` · ${result.updated} di-update` : ""}
                {result.skippedDuplicate > 0
                  ? ` · ${result.skippedDuplicate} di-skip`
                  : ""}
              </p>
            </div>
            {result.errors.length > 0 ? (
              <div className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="mb-1 font-semibold">
                  {result.errors.length} error:
                </p>
                {result.errors.map((e) => (
                  <p key={e.row}>
                    Baris {e.row}: {e.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )
      )}
    </Modal>
  );
}
