/**
 * Sesi AE-160g — Unified Excel multi-sheet template untuk impor lengkap modul
 * Modal & Dividen (Investor / Pengelola / Kreditur dengan saldo dividen).
 *
 * Owner request: 1 template Excel, 1 upload, semua data masuk. Bukan 3 CSV
 * terpisah. Header sheet konsisten dengan kolom DB supaya mapping auto.
 *
 * Sheets:
 *   1. PETUNJUK        — instruksi + deskripsi field
 *   2. INVESTOR        — master + saldo dividen (lengkap)
 *   3. PENGELOLA       — master + saldo dividen
 *   4. KREDITUR        — master + hutang outstanding + bunga
 *
 * Pencairan / withdrawal history TIDAK di-include di template ini (skip
 * untuk MVP — post-jurnal handling kompleks). Owner manage individu via
 * WithdrawalModal kalau perlu.
 */

import * as XLSX from "xlsx";
import type { BulkImportInvestorRow } from "@/features/investors";
import type { BulkImportPengelolaRow } from "@/features/pengelola";
import type { BulkImportCreditorRow } from "@/features/creditors";
import type { HistoricalWithdrawalRow } from "@/features/withdrawals";
import {
  parseDateCell,
  parseDecimalCell,
  parseRupiahCell,
} from "./_csv-utils";

/* ─────────────────────────── Headers ─────────────────────────── */

export const INVESTOR_HEADERS = [
  "Nama Lengkap",
  "NIK",
  "Tanggal Lahir",
  "Alamat Lengkap",
  "Pekerjaan",
  "Nomor Telepon",
  "Akun Instagram",
  "Email",
  "Bank",
  "No Rekening",
  "Atas Nama",
  "Besaran Investasi",
  "Share %",
  "Saldo Dividen",
  "Status",
] as const;

export const PENGELOLA_HEADERS = [
  "Nama Lengkap",
  "Nickname",
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
] as const;

export const PENCAIRAN_HEADERS = [
  "Tanggal",
  "Nama Investor",
  "NIK",
  "Nominal",
  "Bank Sumber",
  "No Rekening Sumber",
  "Catatan",
] as const;

export const KREDITUR_HEADERS = [
  "Nama",
  "Nickname",
  "NIK",
  "Email",
  "Telefon",
  "Alamat",
  "Bank",
  "No Rekening",
  "Atas Nama",
  "Pokok Awal",
  "Sisa Hutang",
  "Bunga %",
  "Periode Bunga",
  "Tanggal Mulai",
  "Jatuh Tempo",
  "Status",
  "Catatan",
] as const;

/* ─────────────────────────── PETUNJUK ─────────────────────────── */

const PETUNJUK_ROWS = [
  ["MAHAKAN POS — TEMPLATE IMPORT MODAL & DIVIDEN"],
  [""],
  ["Cara pakai:"],
  ["1. Isi sheet INVESTOR, PENGELOLA, KREDITUR sesuai data."],
  ["2. Boleh kosongkan sheet yang tidak dipakai."],
  ["3. Header (baris ke-1) JANGAN diubah, urutan kolom JANGAN diganti."],
  ["4. Save file (.xlsx), upload via tombol 'Import Excel' di header."],
  ["5. Preview akan tampil dulu sebelum data masuk DB. Cek baik-baik."],
  [""],
  ["Sheet PENCAIRAN (riwayat pencairan dividen — historical only):"],
  ["• Sheet ini OPSIONAL. Cuma untuk audit trail riwayat pencairan dari periode lama."],
  ["• PENCAIRAN tidak post jurnal akuntansi (jurnal sudah ada dari periode lama)."],
  ["• PENCAIRAN tidak mengurangi saldo dividen (saldo di sheet INVESTOR diasumsikan saldo CURRENT)."],
  ["• Bank Sumber harus sudah ada di Saldo Akun (Settings → Bank). Lookup by nama bank + 4 digit tail rekening."],
  [""],
  ["Format kolom (semua sheet):"],
  ["• Tanggal — pakai YYYY-MM-DD atau DD/MM/YYYY (mis. 1990-05-17 atau 17/5/1990)."],
  ["• Rupiah — boleh pakai 'Rp 1.000.000' atau '1000000' atau '1,000,000'. Sistem strip semua non-digit."],
  ["• Persen — '5' atau '5.5' atau '5,5' (tanpa '%' wajib). 0–100."],
  ["• Status investor/pengelola: active / inactive / exited (atau 'aktif' / 'non-aktif' / 'keluar')."],
  ["• Status kreditur: active / settled / defaulted."],
  ["• Periode bunga: monthly / yearly / flat (atau 'bulanan' / 'tahunan')."],
  [""],
  ["Aturan:"],
  ["• Nama Lengkap wajib di semua sheet."],
  ["• Investor: Besaran Investasi wajib. Share % opsional (kalau kosong dihitung pro-rata)."],
  ["• Pengelola: Modal Disetor wajib. Tidak punya kolom Share % (share dihitung otomatis)."],
  ["• Kreditur: Pokok Awal + Tanggal Mulai wajib. Sisa Hutang default = Pokok Awal kalau kosong."],
  ["• Saldo Dividen opsional. Kalau diisi, jadi saldo awal (untuk migrasi data lama)."],
  [""],
  ["Duplikat:"],
  ["• Investor/Pengelola di-dedup by NIK + nama. Kreditur by nama + tanggal mulai."],
  ["• Default mode 'insert_only' — skip duplikat. Bisa pilih 'upsert' di wizard untuk update existing."],
  [""],
  ["Backup:"],
  ["• Sebelum upload massal, owner backup database dari Neon Console (snapshot)."],
  ["• Mahakan POS punya tombol Reset Modul untuk wipe sebelum re-import — pakai dengan hati-hati."],
] as const;

/* ─────────────────────────── Generator ─────────────────────────── */

export function generateMasterTemplate(): Blob {
  const wb = XLSX.utils.book_new();

  // Sheet PETUNJUK
  const wsPetunjuk = XLSX.utils.aoa_to_sheet(
    PETUNJUK_ROWS.map((r) => [...r]),
  );
  // Lebarkan kolom A (text panjang).
  wsPetunjuk["!cols"] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsPetunjuk, "PETUNJUK");

  // Sheet INVESTOR — header + 2 contoh baris.
  const investorSample = [
    [...INVESTOR_HEADERS],
    [
      "Siti Salsabila",
      "3201234567890001",
      "1995-03-12",
      "Jl. Mawar No. 5, Bandung",
      "Karyawan Swasta",
      "08123456789",
      "@sitisalsa",
      "siti@example.com",
      "BCA",
      "1234567890",
      "Siti Salsabila",
      "5000000",
      "6.5963",
      "0",
      "active",
    ],
    [
      "Muhamad Ramadan",
      "",
      "1998-08-22",
      "Jl. Anggrek No. 12",
      "Mahasiswa",
      "08987654321",
      "",
      "ramadan@example.com",
      "BRI",
      "9876543210",
      "Muhamad Ramadan Saputra",
      "4743500",
      "",
      "150000",
      "active",
    ],
  ];
  const wsInvestor = XLSX.utils.aoa_to_sheet(investorSample);
  wsInvestor["!cols"] = INVESTOR_HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsInvestor, "INVESTOR");

  // Sheet PENGELOLA — header + 1 contoh.
  const pengelolaSample = [
    [...PENGELOLA_HEADERS],
    [
      "Anisa Pratiwi",
      "Anisa",
      "",
      "anisa@mahakan.coffee",
      "08111222333",
      "Bandung",
      "1996-01-15",
      "Mandiri",
      "1100123456789",
      "Anisa Pratiwi",
      "10000000",
      "0",
      "active",
    ],
  ];
  const wsPengelola = XLSX.utils.aoa_to_sheet(pengelolaSample);
  wsPengelola["!cols"] = PENGELOLA_HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsPengelola, "PENGELOLA");

  // Sheet KREDITUR — header + 1 contoh.
  const krediturSample = [
    [...KREDITUR_HEADERS],
    [
      "Pak Budi",
      "",
      "",
      "",
      "08111222444",
      "",
      "BCA",
      "1234567899",
      "Budi Santoso",
      "50000000",
      "30000000",
      "2",
      "monthly",
      "2025-01-15",
      "2026-01-15",
      "active",
      "Pinjaman renovasi outlet",
    ],
  ];
  const wsKreditur = XLSX.utils.aoa_to_sheet(krediturSample);
  wsKreditur["!cols"] = KREDITUR_HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsKreditur, "KREDITUR");

  // Sheet PENCAIRAN — header + 1 contoh.
  const pencairanSample = [
    [...PENCAIRAN_HEADERS],
    [
      "2025-08-15",
      "Siti Salsabila",
      "",
      "500000",
      "BCA",
      "1234567890",
      "Pencairan dividen Agustus 2025",
    ],
  ];
  const wsPencairan = XLSX.utils.aoa_to_sheet(pencairanSample);
  wsPencairan["!cols"] = PENCAIRAN_HEADERS.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, wsPencairan, "PENCAIRAN");

  const arrayBuffer = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ─────────────────────────── Parser ─────────────────────────── */

export interface ParseMasterResult {
  investors: BulkImportInvestorRow[];
  pengelola: BulkImportPengelolaRow[];
  creditors: BulkImportCreditorRow[];
  withdrawals: HistoricalWithdrawalRow[];
  warnings: string[];
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    /* XLSX numeric — bisa jadi tanggal serial atau jumlah Rp. Let cell parser
     * decide; di sini cuma stringify. */
    return String(v);
  }
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v);
}

function sheetToRows(
  wb: XLSX.WorkBook,
  sheetName: string,
  expectedHeaders: readonly string[],
): {
  rows: Array<Record<string, string>>;
  warnings: string[];
} {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { rows: [], warnings: [`Sheet "${sheetName}" tidak ditemukan.`] };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });
  if (aoa.length === 0) return { rows: [], warnings: [] };
  const headerRow = aoa[0]?.map((c) => asString(c).toLowerCase()) ?? [];
  /* Map expected header → column index. Case-insensitive + partial match
   * supaya owner yang sedikit ubah label ("Nama" vs "Nama Lengkap") tetap
   * jalan. Strict order tidak dipaksa selama header ada. */
  const colIdx: Record<string, number> = {};
  const warnings: string[] = [];
  for (const exp of expectedHeaders) {
    const expLow = exp.toLowerCase();
    const idx = headerRow.findIndex(
      (h) => h === expLow || h.includes(expLow) || expLow.includes(h),
    );
    if (idx >= 0) colIdx[exp] = idx;
  }
  const missing = expectedHeaders.filter((h) => !(h in colIdx));
  if (missing.length > 0) {
    warnings.push(
      `Sheet "${sheetName}" — header tidak ditemukan: ${missing.join(", ")}. Cek baris ke-1.`,
    );
  }
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (const h of expectedHeaders) {
      const idx = colIdx[h];
      const cell = idx !== undefined ? row[idx] : undefined;
      const s = asString(cell);
      obj[h] = s;
      if (s.length > 0) hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }
  return { rows, warnings };
}

function parseStatusInvestor(s: string): "active" | "inactive" | "exited" {
  const v = s.toLowerCase().trim();
  if (v === "inactive" || v === "non-aktif" || v === "tidak aktif")
    return "inactive";
  if (v === "exited" || v === "exit" || v === "keluar") return "exited";
  return "active";
}

function parseStatusKreditur(
  s: string,
): "active" | "settled" | "defaulted" {
  const v = s.toLowerCase().trim();
  if (v === "settled" || v === "lunas" || v === "selesai") return "settled";
  if (v === "defaulted" || v === "macet" || v === "gagal") return "defaulted";
  return "active";
}

function parsePeriode(s: string): "monthly" | "yearly" | "flat" {
  const v = s.toLowerCase().trim();
  if (v === "yearly" || v === "tahunan" || v === "year") return "yearly";
  if (v === "flat") return "flat";
  return "monthly";
}

export function parseMasterTemplate(buffer: ArrayBuffer): ParseMasterResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const warnings: string[] = [];

  /* INVESTOR */
  const investorParse = sheetToRows(wb, "INVESTOR", INVESTOR_HEADERS);
  warnings.push(...investorParse.warnings);
  const investors: BulkImportInvestorRow[] = investorParse.rows
    .map((r) => {
      const fullName = r["Nama Lengkap"]?.trim() ?? "";
      if (fullName.length < 2) return null;
      const modal = parseRupiahCell(r["Besaran Investasi"] ?? "");
      if (modal <= 0) return null;
      return {
        fullName,
        nik: r["NIK"]?.trim() || null,
        email: r["Email"]?.trim() || null,
        phone: r["Nomor Telepon"]?.trim() || null,
        address: r["Alamat Lengkap"]?.trim() || null,
        dateOfBirth: parseDateCell(r["Tanggal Lahir"] ?? ""),
        occupation: r["Pekerjaan"]?.trim() || null,
        igHandle: r["Akun Instagram"]?.trim() || null,
        bankName: r["Bank"]?.trim() || null,
        bankAccountNumber: r["No Rekening"]?.trim() || null,
        bankAccountHolderName: r["Atas Nama"]?.trim() || null,
        modalDisetor: modal,
        sharePct: parseDecimalCell(r["Share %"] ?? ""),
        dividendBalance: parseRupiahCell(r["Saldo Dividen"] ?? "") || null,
        status: parseStatusInvestor(r["Status"] ?? "active"),
      } as BulkImportInvestorRow;
    })
    .filter((r): r is BulkImportInvestorRow => r !== null);

  /* PENGELOLA */
  const pengelolaParse = sheetToRows(wb, "PENGELOLA", PENGELOLA_HEADERS);
  warnings.push(...pengelolaParse.warnings);
  const pengelolaRows: BulkImportPengelolaRow[] = pengelolaParse.rows
    .map((r) => {
      const fullName = r["Nama Lengkap"]?.trim() ?? "";
      if (fullName.length < 2) return null;
      const modal = parseRupiahCell(r["Modal Disetor"] ?? "");
      if (modal <= 0) return null;
      return {
        fullName,
        nickname: r["Nickname"]?.trim() || null,
        nik: r["NIK"]?.trim() || null,
        email: r["Email"]?.trim() || null,
        phone: r["Telefon"]?.trim() || null,
        address: r["Alamat"]?.trim() || null,
        dateOfBirth: parseDateCell(r["Tanggal Lahir"] ?? ""),
        bankName: r["Bank"]?.trim() || null,
        bankAccountNumber: r["No Rekening"]?.trim() || null,
        bankAccountHolderName: r["Atas Nama"]?.trim() || null,
        modalDisetor: modal,
        dividendBalance: parseRupiahCell(r["Saldo Dividen"] ?? "") || null,
        status: parseStatusInvestor(r["Status"] ?? "active"),
      } as BulkImportPengelolaRow;
    })
    .filter((r): r is BulkImportPengelolaRow => r !== null);

  /* KREDITUR */
  const krediturParse = sheetToRows(wb, "KREDITUR", KREDITUR_HEADERS);
  warnings.push(...krediturParse.warnings);
  const creditors: BulkImportCreditorRow[] = krediturParse.rows
    .map((r) => {
      const fullName = r["Nama"]?.trim() ?? "";
      if (fullName.length < 2) return null;
      const pokokOriginal = parseRupiahCell(r["Pokok Awal"] ?? "");
      if (pokokOriginal <= 0) return null;
      const startDate =
        parseDateCell(r["Tanggal Mulai"] ?? "") ??
        new Date().toISOString().slice(0, 10);
      const sisa = parseRupiahCell(r["Sisa Hutang"] ?? "");
      return {
        fullName,
        nickname: r["Nickname"]?.trim() || null,
        nik: r["NIK"]?.trim() || null,
        email: r["Email"]?.trim() || null,
        phone: r["Telefon"]?.trim() || null,
        address: r["Alamat"]?.trim() || null,
        bankName: r["Bank"]?.trim() || null,
        bankAccountNumber: r["No Rekening"]?.trim() || null,
        bankAccountHolderName: r["Atas Nama"]?.trim() || null,
        principalOriginal: pokokOriginal,
        principalOutstanding: sisa > 0 ? sisa : pokokOriginal,
        interestRatePct: parseDecimalCell(r["Bunga %"] ?? "") ?? 0,
        interestPeriod: parsePeriode(r["Periode Bunga"] ?? "monthly"),
        startDate,
        dueDate: parseDateCell(r["Jatuh Tempo"] ?? ""),
        status: parseStatusKreditur(r["Status"] ?? "active"),
        notes: r["Catatan"]?.trim() || null,
      } as BulkImportCreditorRow;
    })
    .filter((r): r is BulkImportCreditorRow => r !== null);

  /* PENCAIRAN (opsional sheet). Skip kalau tidak ada atau row 0. */
  const pencairanParse = sheetToRows(wb, "PENCAIRAN", PENCAIRAN_HEADERS);
  // PENCAIRAN sheet opsional — kalau header missing dan sheet tidak ada,
  // jangan warn. Tapi kalau ada sheet tapi header beda, baru warn.
  if (wb.Sheets["PENCAIRAN"]) {
    warnings.push(...pencairanParse.warnings);
  }
  const withdrawals: HistoricalWithdrawalRow[] = pencairanParse.rows
    .map((r) => {
      const investorName = r["Nama Investor"]?.trim() ?? "";
      if (investorName.length < 2) return null;
      const amount = parseRupiahCell(r["Nominal"] ?? "");
      if (amount <= 0) return null;
      const occurredAt =
        parseDateCell(r["Tanggal"] ?? "") ??
        new Date().toISOString().slice(0, 10);
      const bankName = r["Bank Sumber"]?.trim() ?? "";
      if (bankName.length === 0) return null;
      return {
        occurredAt,
        investorName,
        investorNik: r["NIK"]?.trim() || null,
        amount,
        bankName,
        bankAccountNumber: r["No Rekening Sumber"]?.trim() || null,
        description: r["Catatan"]?.trim() || null,
      } as HistoricalWithdrawalRow;
    })
    .filter((r): r is HistoricalWithdrawalRow => r !== null);

  return {
    investors,
    pengelola: pengelolaRows,
    creditors,
    withdrawals,
    warnings,
  };
}

/** Trigger browser download (.xlsx file). */
export function downloadMasterTemplate(filename = "mahakan-modal-template.xlsx") {
  const blob = generateMasterTemplate();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
