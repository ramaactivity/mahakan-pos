"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Upload } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  bulkImportInvestors,
  isOk,
  type BulkImportInvestorRow,
} from "@/features/investors";
import { formatRupiah } from "@/lib/format";

interface InvestorImportWizardProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Sesi AE-63d — Import wizard untuk bulk insert 110+ investor dari CSV.
 *
 * Format CSV expected (mirror "UPDATE DB_INVESTOR_AWAL" Sheets):
 *   Nama Lengkap | Tanggal Lahir | Alamat | Besaran Investasi (Rp ...)
 *   | Bank | No Rekening | Atas Nama | Nomor Telefon | Akun Instagram |
 *   Email | pekerjaan
 *
 * 4 step:
 *  1. Upload — pilih file CSV
 *  2. Preview — parse + tampilkan 5 baris pertama + warning
 *  3. Confirm — kirim ke server
 *  4. Result — summary inserted/duplicate/error
 */

type Step = "upload" | "preview" | "result";

interface ParsedRow extends BulkImportInvestorRow {
  rawRowNum: number;
}

interface ImportResult {
  totalRows: number;
  inserted: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}

/* Parse CSV manual — minimal, support quoted field dengan koma + Rp prefix. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

function parseRupiahCell(s: string): number {
  /* "Rp 1,700,000" / "Rp1.700.000" → 1700000 */
  const cleaned = s.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function parseDateCell(s: string): string | null {
  /* Accept variants: "7/1/1996", "02 June 1999", "20 March 2001",
   *  "1999-06-02". Output YYYY-MM-DD or null kalau gagal. */
  if (!s || s.trim().length === 0) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  /* Try JS Date parse (handles "02 June 1999"). */
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  if (yyyy < 1900 || yyyy > 2100) return null;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function findHeaderIdx(headers: string[], patterns: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    for (const p of patterns) {
      if (h.includes(p.toLowerCase())) return i;
    }
  }
  return -1;
}

function mapRow(
  row: string[],
  idx: {
    name: number;
    dob: number;
    address: number;
    investment: number;
    bank: number;
    accountNumber: number;
    accountHolder: number;
    phone: number;
    ig: number;
    email: number;
    occupation: number;
  },
  rowNum: number,
): { ok: true; row: ParsedRow } | { ok: false; reason: string } {
  const get = (i: number) => (i >= 0 && i < row.length ? row[i] : "");
  const fullName = get(idx.name).trim();
  if (!fullName || fullName.length < 2) {
    return { ok: false, reason: "Nama kosong / terlalu pendek" };
  }
  const modal = parseRupiahCell(get(idx.investment));
  if (modal < 0) {
    return { ok: false, reason: "Modal invalid" };
  }
  return {
    ok: true,
    row: {
      rawRowNum: rowNum,
      fullName,
      dateOfBirth: parseDateCell(get(idx.dob)),
      address: get(idx.address).trim() || null,
      phone: get(idx.phone).replace(/^'/, "").trim() || null,
      igHandle: get(idx.ig).replace(/^'/, "").trim() || null,
      email: get(idx.email).trim() || null,
      occupation: get(idx.occupation).trim() || null,
      bankName: get(idx.bank).trim() || null,
      bankAccountNumber: get(idx.accountNumber).trim() || null,
      bankAccountHolderName: get(idx.accountHolder).trim() || null,
      modalDisetor: modal,
    },
  };
}

export function InvestorImportWizard({
  open,
  onClose,
  onImported,
}: InvestorImportWizardProps) {
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => {
    if (!csvText) return { parsedRows: [] as ParsedRow[], parseErrors: [] as { row: number; reason: string }[] };
    const { headers, rows } = parseCsv(csvText);
    const idx = {
      name: findHeaderIdx(headers, ["nama lengkap", "nama"]),
      dob: findHeaderIdx(headers, ["tanggal lahir", "dob"]),
      address: findHeaderIdx(headers, ["alamat lengkap", "alamat"]),
      investment: findHeaderIdx(headers, ["besaran investasi", "investasi"]),
      bank: findHeaderIdx(headers, ["bank"]),
      accountNumber: findHeaderIdx(headers, ["no rekening", "rekening"]),
      accountHolder: findHeaderIdx(headers, ["atas nama"]),
      phone: findHeaderIdx(headers, ["nomor telefon", "telefon", "telp", "hp"]),
      ig: findHeaderIdx(headers, ["instagram", "ig", "akun instagram"]),
      email: findHeaderIdx(headers, ["email"]),
      occupation: findHeaderIdx(headers, ["pekerjaan"]),
    };
    if (idx.name < 0 || idx.investment < 0) {
      return {
        parsedRows: [],
        parseErrors: [
          {
            row: 0,
            reason: 'CSV harus punya kolom "Nama Lengkap" + "Besaran Investasi"',
          },
        ],
      };
    }
    const parsedRows: ParsedRow[] = [];
    const parseErrors: { row: number; reason: string }[] = [];
    rows.forEach((row, i) => {
      const r = mapRow(row, idx, i + 2); // +2: skip header + 1-indexed
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
      toast.error("Tidak ada baris valid untuk di-import");
      return;
    }
    setSubmitting(true);
    const res = await bulkImportInvestors({
      rows: parsed.parsedRows.map((r) => ({
        fullName: r.fullName,
        nik: r.nik ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        dateOfBirth: r.dateOfBirth ?? null,
        occupation: r.occupation ?? null,
        igHandle: r.igHandle ?? null,
        bankName: r.bankName ?? null,
        bankAccountNumber: r.bankAccountNumber ?? null,
        bankAccountHolderName: r.bankAccountHolderName ?? null,
        modalDisetor: r.modalDisetor,
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

  const totalModal = parsed.parsedRows.reduce(
    (s, r) => s + r.modalDisetor,
    0,
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Investor dari CSV"
      description="Bulk import dari Sheets MAHAKAN BUSINESS DASHBOARD."
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
                Import {parsed.parsedRows.length} Investor
              </Button>
            ) : null}
          </>
        )
      }
    >
      {step === "upload" ? (
        <div className="space-y-4">
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
            <Upload className="mx-auto size-8 text-neutral-400" />
            <p className="mt-2 text-sm text-neutral-700">
              Pilih file CSV dari export Sheets
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Header expected: Nama Lengkap, Tanggal Lahir, Alamat,
              Besaran Investasi, Bank, No Rekening, Atas Nama, Nomor
              Telefon, Akun Instagram, Email, pekerjaan
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="mt-3 block w-full cursor-pointer rounded border border-neutral-300 bg-white p-2 text-sm"
            />
          </div>
          <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-900">
            💡 Duplikat akan otomatis di-skip berdasar NIK atau nama (case-insensitive).
            Max 500 baris per import.
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
                {parsed.parseErrors.length} baris error parsing
              </span>
            ) : null}
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
              Total modal: {formatRupiah(totalModal)}
            </span>
          </div>

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
                {parsed.parseErrors.length > 10 ? (
                  <li>... dan {parsed.parseErrors.length - 10} lainnya</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="px-2 py-1.5">No</th>
                  <th className="px-2 py-1.5">Nama</th>
                  <th className="px-2 py-1.5">Modal</th>
                  <th className="px-2 py-1.5">Email</th>
                  <th className="px-2 py-1.5">Bank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {parsed.parsedRows.slice(0, 10).map((r) => (
                  <tr key={r.rawRowNum}>
                    <td className="px-2 py-1">{r.rawRowNum}</td>
                    <td className="px-2 py-1 font-medium">{r.fullName}</td>
                    <td className="px-2 py-1 tabular-nums">
                      {formatRupiah(r.modalDisetor)}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.email ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.bankName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.parsedRows.length > 10 ? (
              <p className="px-2 py-1.5 text-center text-xs text-neutral-500">
                ... dan {parsed.parsedRows.length - 10} baris lainnya
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        /* result step */
        result && (
          <div className="space-y-3">
            <div className="rounded-md bg-emerald-50 p-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
              <p className="mt-2 text-base font-semibold text-emerald-900">
                Import selesai
              </p>
              <p className="text-xs text-emerald-800">
                {result.inserted} investor baru ditambahkan
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Total Baris" value={result.totalRows} />
              <Stat label="Inserted" value={result.inserted} tone="success" />
              <Stat
                label="Duplikat dilewati"
                value={result.skippedDuplicate}
                tone="warning"
              />
              <Stat
                label="Error"
                value={result.errors.length}
                tone={result.errors.length > 0 ? "danger" : "neutral"}
              />
            </dl>
            {result.errors.length > 0 ? (
              <div className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
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

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "danger"
          ? "text-red-700"
          : "text-neutral-700";
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

/* Avoid unused-var lint */
void FileText;
