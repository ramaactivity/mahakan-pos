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
  bulkImportCreditors,
  isOk,
  type BulkImportCreditorRow,
  type CreditorStatus,
  type InterestPeriod,
} from "@/features/creditors";
import { formatRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";
import {
  detectFractionScale,
  downloadCsv,
  findHeaderIdx,
  parseCsv,
  parseDateCell,
  parseDecimalCell,
  parseRupiahCell,
  rowsToCsv,
} from "./_csv-utils";

/**
 * Sesi AE-80 follow-up — CSV import wizard untuk kreditur.
 *
 * Dedup key: (fullName + start_date) — owner bisa upload beberapa pinjaman
 * dari orang yang sama dengan start_date berbeda (treated sebagai kontrak
 * berbeda).
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = "upload" | "preview" | "result";

interface ParsedRow extends BulkImportCreditorRow {
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

function parseStatus(s: string): CreditorStatus | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "active" || v === "aktif") return "active";
  if (v === "settled" || v === "lunas") return "settled";
  if (v === "defaulted" || v === "default" || v === "macet") return "defaulted";
  return undefined;
}

function parsePeriod(s: string): InterestPeriod | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "monthly" || v === "bulanan" || v === "month") return "monthly";
  if (v === "yearly" || v === "tahunan" || v === "year") return "yearly";
  if (v === "flat") return "flat";
  return undefined;
}

const today = () => todayJakarta();

function mapRow(
  row: string[],
  idx: {
    name: number;
    nik: number;
    email: number;
    phone: number;
    address: number;
    bank: number;
    accountNumber: number;
    accountHolder: number;
    principalOriginal: number;
    principalOutstanding: number;
    interestRatePct: number;
    interestPeriod: number;
    startDate: number;
    dueDate: number;
    status: number;
    notes: number;
  },
  rowNum: number,
): { ok: true; row: ParsedRow } | { ok: false; reason: string } {
  const get = (i: number) => (i >= 0 && i < row.length ? row[i] : "");
  const fullName = get(idx.name).trim();
  if (!fullName || fullName.length < 2) {
    return { ok: false, reason: "Nama kosong / terlalu pendek" };
  }
  const principal = parseRupiahCell(get(idx.principalOriginal));
  if (principal <= 0) {
    return { ok: false, reason: "Pokok awal harus > 0" };
  }
  const outstandingRaw =
    idx.principalOutstanding >= 0
      ? parseRupiahCell(get(idx.principalOutstanding))
      : null;
  const outstanding =
    idx.principalOutstanding >= 0 && get(idx.principalOutstanding).trim()
      ? outstandingRaw
      : null;
  if (outstanding != null && outstanding > principal) {
    return {
      ok: false,
      reason: "Sisa hutang > pokok awal",
    };
  }
  const startDate = parseDateCell(get(idx.startDate)) ?? today();
  const dueDate = idx.dueDate >= 0 ? parseDateCell(get(idx.dueDate)) : null;
  if (dueDate && dueDate < startDate) {
    return { ok: false, reason: "Jatuh tempo < tanggal mulai" };
  }
  /* Sesi AE-178 — range check Bunga % digeser ke pass-2 (setelah deteksi
   * Excel "Percent format"; 18% di Excel underlying = 0.18). */
  const rateRaw =
    idx.interestRatePct >= 0
      ? parseDecimalCell(get(idx.interestRatePct))
      : null;
  const rate = rateRaw != null ? rateRaw : undefined;
  const period = idx.interestPeriod >= 0 ? parsePeriod(get(idx.interestPeriod)) : undefined;
  if (idx.interestPeriod >= 0 && get(idx.interestPeriod).trim() && !period) {
    return { ok: false, reason: `Period bunga tidak dikenal "${get(idx.interestPeriod)}"` };
  }
  const status = idx.status >= 0 ? parseStatus(get(idx.status)) : undefined;
  if (idx.status >= 0 && get(idx.status).trim() && !status) {
    return { ok: false, reason: `Status tidak dikenal "${get(idx.status)}"` };
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
      bankName: get(idx.bank).trim() || null,
      bankAccountNumber: get(idx.accountNumber).trim() || null,
      bankAccountHolderName: get(idx.accountHolder).trim() || null,
      principalOriginal: principal,
      principalOutstanding: outstanding,
      interestRatePct: rate,
      interestPeriod: period,
      startDate,
      dueDate,
      status,
      notes: get(idx.notes).trim() || null,
    },
  };
}

export function CreditorImportWizard({ open, onClose, onImported }: Props) {
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
        delimiter: "," as "," | ";" | "\t",
        bungaAutoScaled: false,
      };
    const { headers, rows, delimiter } = parseCsv(csvText);
    const idx = {
      name: findHeaderIdx(headers, ["nama lengkap", "nama"]),
      nik: findHeaderIdx(headers, ["nik"]),
      email: findHeaderIdx(headers, ["email"]),
      phone: findHeaderIdx(headers, ["telefon", "telp", "hp", "phone"]),
      address: findHeaderIdx(headers, ["alamat"]),
      bank: findHeaderIdx(headers, ["bank"]),
      accountNumber: findHeaderIdx(headers, ["no rekening", "rekening"]),
      accountHolder: findHeaderIdx(headers, ["atas nama"]),
      principalOriginal: findHeaderIdx(headers, [
        "pokok awal",
        "pokok original",
        "pokok",
      ]),
      principalOutstanding: findHeaderIdx(headers, [
        "sisa hutang",
        "sisa pokok",
        "outstanding",
      ]),
      interestRatePct: findHeaderIdx(headers, ["bunga", "interest"]),
      interestPeriod: findHeaderIdx(headers, ["period", "periode bunga"]),
      startDate: findHeaderIdx(headers, ["tanggal mulai", "start date"]),
      dueDate: findHeaderIdx(headers, ["jatuh tempo", "due date"]),
      status: findHeaderIdx(headers, ["status"]),
      notes: findHeaderIdx(headers, ["catatan", "notes"]),
    };
    if (idx.name < 0 || idx.principalOriginal < 0 || idx.startDate < 0) {
      return {
        parsedRows: [],
        parseErrors: [
          {
            row: 0,
            reason:
              'CSV harus punya kolom "Nama Lengkap" + "Pokok Awal" + "Tanggal Mulai"',
          },
        ],
        delimiter,
        bungaAutoScaled: false,
      };
    }
    const candidateRows: ParsedRow[] = [];
    const parseErrors: { row: number; reason: string }[] = [];
    rows.forEach((row, i) => {
      const r = mapRow(row, idx, i + 2);
      if (r.ok) candidateRows.push(r.row);
      else parseErrors.push({ row: i + 2, reason: r.reason });
    });

    /* Pass-2: deteksi Bunga % format Excel "Percent" (18% underlying = 0.18).
     * Berbeda dari Share %: Bunga TIDAK jumlah ke 100, jadi pakai detector
     * stand-alone (semua ≤ 1 & minimal 1 nilai 0<v<1). */
    const bungaVals = candidateRows
      .map((r) => r.interestRatePct)
      .filter((v): v is number => v != null);
    const bungaAutoScaled =
      idx.interestRatePct >= 0 && detectFractionScale(bungaVals);
    if (bungaAutoScaled) {
      for (const r of candidateRows) {
        if (r.interestRatePct != null) r.interestRatePct *= 100;
      }
    }

    /* Pass-3: range validation post-scaling. */
    const parsedRows: ParsedRow[] = [];
    for (const r of candidateRows) {
      if (
        r.interestRatePct != null &&
        (r.interestRatePct < 0 || r.interestRatePct > 100)
      ) {
        parseErrors.push({
          row: r.rawRowNum,
          reason: `Bunga % di luar range 0..100 (nilai: ${r.interestRatePct.toFixed(2)})`,
        });
        continue;
      }
      parsedRows.push(r);
    }
    return { parsedRows, parseErrors, delimiter, bungaAutoScaled };
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
    const res = await bulkImportCreditors({
      mode,
      rows: parsed.parsedRows.map((r) => ({
        fullName: r.fullName,
        nickname: r.nickname ?? null,
        nik: r.nik ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        bankName: r.bankName ?? null,
        bankAccountNumber: r.bankAccountNumber ?? null,
        bankAccountHolderName: r.bankAccountHolderName ?? null,
        principalOriginal: r.principalOriginal,
        principalOutstanding: r.principalOutstanding ?? null,
        interestRatePct: r.interestRatePct,
        interestPeriod: r.interestPeriod,
        startDate: r.startDate,
        dueDate: r.dueDate ?? null,
        status: r.status,
        notes: r.notes ?? null,
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
      "Bank",
      "No Rekening",
      "Atas Nama",
      "Pokok Awal",
      "Sisa Hutang",
      "Bunga (%)",
      "Period Bunga",
      "Tanggal Mulai",
      "Jatuh Tempo",
      "Status",
      "Catatan",
    ];
    const sample: (string | number)[][] = [
      [
        "Bapak Suhardi",
        "",
        "",
        "+6281234567899",
        "Jl. Sudirman No. 5, Jakarta",
        "BCA",
        "8881234567",
        "Suhardi",
        10000000,
        7500000,
        "2",
        "monthly",
        "2025-08-15",
        "2027-08-15",
        "active",
        "Pinjaman renovasi outlet",
      ],
      [
        "Ibu Sari",
        "",
        "",
        "",
        "",
        "Mandiri",
        "1700099887766",
        "Sari Wahyuni",
        5000000,
        0,
        "1.5",
        "flat",
        "2024-06-01",
        "2025-06-01",
        "settled",
        "Lunas pre-system",
      ],
    ];
    downloadCsv(
      "template-import-kreditur-mahakan.csv",
      rowsToCsv(headers, sample),
    );
    toast.success("Template CSV ter-download");
  }

  const totalPokok = parsed.parsedRows.reduce(
    (s, r) => s + r.principalOriginal,
    0,
  );
  const totalOutstanding = parsed.parsedRows.reduce(
    (s, r) => s + (r.principalOutstanding ?? r.principalOriginal),
    0,
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Kreditur dari CSV"
      description="Bulk import daftar hutang kreditur Mahakan."
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
                Import {parsed.parsedRows.length} Kreditur
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
              Pilih file CSV (max 500 baris)
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              <b>Wajib:</b> Nama Lengkap, Pokok Awal, Tanggal Mulai.{" "}
              <b>Optional:</b> Sisa Hutang, Bunga (%), Period Bunga
              (monthly/yearly/flat), Jatuh Tempo, Status
              (active/settled/defaulted), NIK, Email, Bank info.
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
              <p className="mb-1 font-semibold">💡 Dedup key</p>
              <p>
                Nama + Tanggal Mulai. Owner boleh punya 2 pinjaman dari orang
                sama dengan start date beda — treated sebagai kontrak berbeda.
              </p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-1 font-semibold">⚠️ Sisa Hutang</p>
              <p>
                Kalau kosong, default = pokok awal. Untuk seed historical owner
                bisa input outstanding &lt; pokok kalau sudah sebagian dicicil.
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
              Total pokok: {formatRupiah(totalPokok)}
            </span>
            <span className="rounded-full bg-warning-100 px-3 py-1 text-warning-900">
              Total outstanding: {formatRupiah(totalOutstanding)}
            </span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">
              Pemisah:{" "}
              {parsed.delimiter === ";"
                ? "titik koma (;)"
                : parsed.delimiter === "\t"
                  ? "tab"
                  : "koma (,)"}
            </span>
          </div>

          {parsed.bungaAutoScaled ? (
            <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-semibold">
                ℹ️ Bunga % auto-konversi dari format desimal Excel
              </p>
              <p className="mt-0.5">
                Kolom Bunga % terdeteksi pakai format Excel "Percent" (underlying
                value 0–1, mis. <code>0,18</code> ditampilkan <code>18%</code>).
                Sistem otomatis mengalikan 100. Cek nilai bunga di tabel — kalau
                sudah benar, lanjut import.
              </p>
            </div>
          ) : null}

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
                  name="mode-kreditur"
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
                    Skip kalau (nama + tanggal mulai) sudah ada.
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
                  name="mode-kreditur"
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
                    Update sisa hutang, bunga, status, dll dari CSV.
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
                  <th className="px-2 py-1.5 text-right">Pokok</th>
                  <th className="px-2 py-1.5 text-right">Sisa</th>
                  <th className="px-2 py-1.5">Bunga</th>
                  <th className="px-2 py-1.5">Mulai</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {parsed.parsedRows.slice(0, 10).map((r) => (
                  <tr key={r.rawRowNum}>
                    <td className="px-2 py-1">{r.rawRowNum}</td>
                    <td className="px-2 py-1 font-medium">{r.fullName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatRupiah(r.principalOriginal)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-warning-700">
                      {formatRupiah(
                        r.principalOutstanding ?? r.principalOriginal,
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.interestRatePct != null
                        ? `${r.interestRatePct}% / ${r.interestPeriod ?? "monthly"}`
                        : "0%"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.startDate}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {r.status ?? "active"}
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
