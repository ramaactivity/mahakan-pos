"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Upload } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  bulkImportInvestors,
  isOk,
  type BulkImportInvestorRow,
  type InvestorStatus,
} from "@/features/investors";
import { formatRupiah } from "@/lib/format";
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
  updated: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; reason: string }>;
}

type ImportMode = "insert_only" | "upsert";

function parseStatusCell(s: string): InvestorStatus | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "active" || v === "aktif") return "active";
  if (v === "inactive" || v === "non-aktif" || v === "tidak aktif")
    return "inactive";
  if (v === "exited" || v === "exit" || v === "keluar") return "exited";
  return undefined;
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
    sharePct: number;
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
  const modal = parseRupiahCell(get(idx.investment));
  if (modal < 0) {
    return { ok: false, reason: "Modal invalid" };
  }
  /* Sesi AE-178 — range check digeser ke pass-2 (setelah deteksi fraction
   * Excel "Percent format" — underlying 0.0862 ditampilkan 8,62%). */
  const sharePctRaw = idx.sharePct >= 0 ? parseDecimalCell(get(idx.sharePct)) : null;
  const balanceRaw =
    idx.dividendBalance >= 0 ? parseRupiahCell(get(idx.dividendBalance)) : 0;
  const balance = idx.dividendBalance >= 0 ? balanceRaw : null;
  const status = idx.status >= 0 ? parseStatusCell(get(idx.status)) : undefined;
  if (idx.status >= 0 && get(idx.status).trim() && !status) {
    return {
      ok: false,
      reason: `Status tidak dikenal: "${get(idx.status)}" (pakai active/inactive/exited)`,
    };
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
      sharePct: sharePctRaw,
      dividendBalance: balance,
      status,
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
  /* Sesi AE-68 — mode default 'insert_only' (backward-compat: first migration
   * dari Sheets pakai ini). User pilih 'upsert' kalau re-upload CSV dengan
   * koreksi data (nominal/email berubah, name match → update). */
  const [mode, setMode] = useState<ImportMode>("insert_only");

  const parsed = useMemo(() => {
    if (!csvText)
      return {
        parsedRows: [] as ParsedRow[],
        parseErrors: [] as { row: number; reason: string }[],
        delimiter: "," as "," | ";" | "\t",
        fractionAutoScaled: false,
      };
    const { headers, rows, delimiter } = parseCsv(csvText);
    const idx = {
      name: findHeaderIdx(headers, ["nama lengkap", "nama"]),
      dob: findHeaderIdx(headers, ["tanggal lahir", "dob"]),
      address: findHeaderIdx(headers, ["alamat lengkap", "alamat"]),
      investment: findHeaderIdx(headers, [
        "besaran investasi",
        "modal disetor",
        "modal",
        "investasi",
      ]),
      bank: findHeaderIdx(headers, ["bank"]),
      accountNumber: findHeaderIdx(headers, ["no rekening", "rekening"]),
      accountHolder: findHeaderIdx(headers, ["atas nama"]),
      phone: findHeaderIdx(headers, ["nomor telefon", "telefon", "telp", "hp"]),
      ig: findHeaderIdx(headers, ["instagram", "ig", "akun instagram"]),
      email: findHeaderIdx(headers, ["email"]),
      occupation: findHeaderIdx(headers, ["pekerjaan"]),
      sharePct: findHeaderIdx(headers, ["share %", "share%", "share pct", "share"]),
      dividendBalance: findHeaderIdx(headers, [
        "saldo dividen",
        "saldo dividend",
        "dividend balance",
      ]),
      status: findHeaderIdx(headers, ["status"]),
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
        delimiter,
        fractionAutoScaled: false,
      };
    }
    const candidateRows: ParsedRow[] = [];
    const parseErrors: { row: number; reason: string }[] = [];
    rows.forEach((row, i) => {
      const r = mapRow(row, idx, i + 2); // +2: skip header + 1-indexed
      if (r.ok) candidateRows.push(r.row);
      else parseErrors.push({ row: i + 2, reason: r.reason });
    });

    /* Pass-2: deteksi Excel "Percent format" — kalau owner export underlying
     * value, value 8,62% jadi 0,0862 di CSV. Pakai shared helper
     * `detectFractionScale` dengan expectedSumOne=true (share investor
     * jumlah ke 100%). */
    const shareVals = candidateRows
      .map((r) => r.sharePct)
      .filter((v): v is number => v != null);
    const fractionAutoScaled =
      idx.sharePct >= 0 &&
      detectFractionScale(shareVals, { expectedSumOne: true });
    if (fractionAutoScaled) {
      for (const r of candidateRows) {
        if (r.sharePct != null) r.sharePct = r.sharePct * 100;
      }
    }

    /* Pass-3: range validation (setelah scaling). */
    const parsedRows: ParsedRow[] = [];
    for (const r of candidateRows) {
      if (r.sharePct != null && (r.sharePct < 0 || r.sharePct > 100)) {
        parseErrors.push({
          row: r.rawRowNum,
          reason: `Share % di luar range 0..100 (nilai: ${r.sharePct.toFixed(4)})`,
        });
        continue;
      }
      parsedRows.push(r);
    }
    return { parsedRows, parseErrors, delimiter, fractionAutoScaled };
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
      mode,
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
        sharePct: r.sharePct ?? null,
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

  /* Sesi AE-63 polish + AE-80 follow-up — Template CSV downloadable.
   * Header sama dengan parser auto-detect supaya import langsung berhasil
   * tanpa edit kolom. Include 2 row example (Mahakan-style). Tambah kolom
   * Share % / Saldo Dividen / Status untuk v2. */
  function handleDownloadTemplate() {
    const headers = [
      "Nama Lengkap",
      "Tanggal Lahir",
      "Alamat Lengkap",
      "Besaran Investasi",
      "Bank",
      "No Rekening",
      "Atas Nama",
      "Nomor Telefon",
      "Akun Instagram",
      "Email",
      "Pekerjaan",
      "Share %",
      "Saldo Dividen",
      "Status",
    ];
    const sample: (string | number)[][] = [
      [
        "Aan Najmutsaqib",
        "1996-07-01",
        "Dsn mojounggul bareng jombang",
        300000,
        "BRI",
        "624101014994534",
        "Najmutsaqib",
        "+6285815194914",
        "@an_najmast_tsaqib",
        "thomasahmad01@gmail.com",
        "Pelajar / Mahasiswa",
        "",
        "",
        "active",
      ],
      [
        "Aina Noor Ade Faradilla",
        "1999-06-02",
        "Komplek Kembang Larangan Jl. Manggar IV Blok B5 No.11, Tangerang",
        500000,
        "Mandiri",
        "1640002282293",
        "Aina Noor Ade Faradilla",
        "+6287887302993",
        "@naainaanoo",
        "ainafaradilla@gmail.com",
        "Pelajar / Mahasiswa",
        "5.25",
        "150000",
        "active",
      ],
    ];
    downloadCsv(
      "template-import-investor-mahakan.csv",
      rowsToCsv(headers, sample),
    );
    toast.success("Template CSV ter-download — isi data lalu upload");
  }

  const totalModal = parsed.parsedRows.reduce(
    (s, r) => s + r.modalDisetor,
    0,
  );
  /* Sesi AE-178 audit P2 — sanity warning untuk nilai modal di luar nalar
   * (kemungkinan owner salah tambah nol). Mahakan total modal ~Rp 100jt,
   * single row > 1 milyar hampir pasti typo. */
  const HUGE_MODAL_THRESHOLD = 1_000_000_000;
  const hugeModalRows = parsed.parsedRows.filter(
    (r) => r.modalDisetor > HUGE_MODAL_THRESHOLD,
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
          {/* Template download — Mahakan owner's first ask di sesi ini. */}
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
                  Download template Excel/CSV dengan kolom dan format yang
                  sudah benar. Tinggal isi data lalu upload kembali.
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
              Auto-detect kolom: Nama Lengkap, Tanggal Lahir, Alamat,
              Besaran Investasi, Bank, No Rekening, Atas Nama, Telefon,
              Instagram, Email, Pekerjaan. <b>Optional v2:</b> Share %,
              Saldo Dividen, Status (active/inactive/exited).
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
              <p>Auto-skip baris dengan NIK / nama yang sudah ada
                (case-insensitive).</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-1 font-semibold">⚠️ Format tanggal</p>
              <p>Pakai YYYY-MM-DD (mis. 1999-06-02) atau text bulan
                ("02 June 1999").</p>
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
                {parsed.parseErrors.length} baris error parsing
              </span>
            ) : null}
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
              Total modal: {formatRupiah(totalModal)}
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

          {parsed.fractionAutoScaled ? (
            <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-semibold">
                ℹ️ Share % auto-konversi dari format desimal Excel
              </p>
              <p className="mt-0.5">
                Kolom Share % terdeteksi pakai format Excel "Percent" (underlying
                value 0–1, mis. <code>0,0862</code>). Sistem otomatis mengalikan
                100 supaya jadi persentase (0,0862 → 8,62%). Cek tabel di bawah
                — kalau nilai-nya sudah benar, lanjut import.
              </p>
            </div>
          ) : null}

          {hugeModalRows.length > 0 ? (
            <div className="rounded-md border border-warning-400 bg-warning-50 p-3 text-xs text-warning-900">
              <p className="font-semibold">
                ⚠️ Ada {hugeModalRows.length} baris dengan modal {">"} Rp 1
                milyar
              </p>
              <p className="mt-0.5">
                Cek apakah tidak salah tambah nol. Mahakan total modal sekitar
                Rp 100 juta — single investor di atas Rp 1 milyar kemungkinan
                typo:
              </p>
              <ul className="mt-1 space-y-0.5">
                {hugeModalRows.slice(0, 5).map((r) => (
                  <li key={r.rawRowNum}>
                    • Baris {r.rawRowNum}: <strong>{r.fullName}</strong> —{" "}
                    {formatRupiah(r.modalDisetor)}
                  </li>
                ))}
                {hugeModalRows.length > 5 ? (
                  <li>... dan {hugeModalRows.length - 5} lainnya</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* Sesi AE-68 — Mode selector (insert_only vs upsert).
           * Default 'insert_only' = first-time migration (skip kalau nama
           * sudah ada). 'upsert' = re-upload CSV dengan koreksi (kalau nama
           * sudah ada, update field nominal/email/dll). */}
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
                  name="import-mode"
                  value="insert_only"
                  checked={mode === "insert_only"}
                  onChange={() => setMode("insert_only")}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold text-neutral-900">
                    Tambah Saja (Skip Duplikat)
                  </span>
                  <span className="mt-0.5 block text-[11px] text-neutral-600">
                    Kalau nama / NIK sudah ada di sistem, baris itu di-skip.
                    Cocok untuk import pertama kali dari Sheets.
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
                  name="import-mode"
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
                    Kalau nama / NIK sudah ada, <strong>update</strong> field-nya
                    pakai nilai baru dari CSV (nominal, email, dll). Cocok
                    untuk re-upload setelah koreksi data.
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
                  <th className="px-2 py-1.5 text-right">Modal</th>
                  <th className="px-2 py-1.5 text-right">Share %</th>
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
                      {r.sharePct != null ? `${r.sharePct.toFixed(2)}%` : "—"}
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
            {parsed.parsedRows.length > 10 ? (
              <p className="px-2 py-1.5 text-center text-xs text-neutral-500">
                ... dan {parsed.parsedRows.length - 10} baris lainnya
              </p>
            ) : null}
          </div>

          {/* Sum sharePct sanity check + saldo dividen total. */}
          {(() => {
            const rowsWithShare = parsed.parsedRows.filter(
              (r) => r.sharePct != null,
            );
            const sumShare = rowsWithShare.reduce(
              (s, r) => s + (r.sharePct ?? 0),
              0,
            );
            const sumBalance = parsed.parsedRows.reduce(
              (s, r) => s + (r.dividendBalance ?? 0),
              0,
            );
            const shareDrift = rowsWithShare.length > 0 && Math.abs(sumShare - 100) > 0.01;
            return (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {rowsWithShare.length > 0 ? (
                  <span
                    className={`rounded-full px-2.5 py-1 ${shareDrift ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
                  >
                    Σ Share %: {sumShare.toFixed(4)}%{" "}
                    {shareDrift ? "(≠ 100)" : "✓"}
                  </span>
                ) : null}
                {sumBalance > 0 ? (
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-900">
                    Σ Saldo Dividen: {formatRupiah(sumBalance)}
                  </span>
                ) : null}
              </div>
            );
          })()}
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
                {result.inserted} baru ditambahkan
                {result.updated > 0
                  ? ` · ${result.updated} di-update`
                  : ""}
                {result.skippedDuplicate > 0
                  ? ` · ${result.skippedDuplicate} di-skip (sudah ada)`
                  : ""}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Total Baris" value={result.totalRows} />
              <Stat label="Baru" value={result.inserted} tone="success" />
              <Stat
                label="Di-update"
                value={result.updated}
                tone={result.updated > 0 ? "success" : "neutral"}
              />
              <Stat
                label="Di-skip"
                value={result.skippedDuplicate}
                tone={result.skippedDuplicate > 0 ? "warning" : "neutral"}
              />
            </dl>
            {result.skippedDuplicate > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">
                  💡 {result.skippedDuplicate} baris di-skip karena nama / NIK
                  sudah ada di sistem.
                </p>
                <p className="mt-1">
                  Kalau lo mau <strong>update</strong> data investor yang sudah
                  ada (mis. koreksi nominal/email), upload ulang dengan mode
                  <strong> Tambah / Update (Upsert)</strong> di step preview.
                </p>
              </div>
            ) : null}
            {result.errors.length > 0 ? (
              <div className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="mb-1 font-semibold">
                  {result.errors.length} baris error:
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

