/**
 * Fixed Asset CSV Import — pure parser + validator.
 *
 * Schema (header row required):
 *   nama,kategori,cost,salvage_value,useful_life_months,acquired_date,asset_account_code,depreciation_account_code,capitalize,payment_method,notes
 *
 * Required: nama, cost, useful_life_months, acquired_date, asset_account_code, depreciation_account_code
 * Optional: kategori, salvage_value (default 0), capitalize (default "false"), payment_method (default "transfer_bca"), notes
 *
 * Owner workflow:
 *   1. Click "Import CSV" di FixedAssetsView header
 *   2. Download template (browser-side, format documented in modal)
 *   3. Fill spreadsheet, save as CSV (UTF-8)
 *   4. Upload → preview validation table (errors per-row)
 *   5. Confirm → bulk insert + optional capitalize journal entries
 *
 * Pure functions tested separately. No DB I/O di parser.
 */

import Papa from "papaparse";

export type FixedAssetImportRow = {
  /** 1-indexed CSV row number untuk error display. */
  rowNumber: number;
  name: string;
  category: string | null;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  acquiredDate: string;
  assetAccountCode: string;
  depreciationAccountCode: string;
  capitalize: boolean;
  paymentMethod: "cash" | "transfer_bca" | "transfer_bri" | "transfer_other";
  notes: string | null;
};

export type FixedAssetImportError = {
  rowNumber: number;
  field: string;
  message: string;
};

export type FixedAssetImportPreview = {
  rows: FixedAssetImportRow[];
  errors: FixedAssetImportError[];
  /** Total CSV rows parsed (include errored). */
  totalParsed: number;
};

const VALID_ASSET_CODES = ["1201", "1202", "1203", "1204"];
const VALID_DEP_CODES = ["6501", "6502", "6503", "6504"];
const VALID_PAYMENT_METHODS = [
  "cash",
  "transfer_bca",
  "transfer_bri",
  "transfer_other",
];

/** Normalize CSV header keys: trim, lowercase, replace whitespace with _. */
function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseNumberOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[.,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBoolish(s: string | undefined): boolean {
  if (!s) return false;
  const v = s.trim().toLowerCase();
  return ["true", "1", "yes", "y", "ya", "iya"].includes(v);
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

/**
 * Parse + validate CSV string. Returns rows + errors (per-row).
 * Each row independently validated; errors don't stop iteration.
 */
export function parseFixedAssetCsv(csv: string): FixedAssetImportPreview {
  const rows: FixedAssetImportRow[] = [];
  const errors: FixedAssetImportError[] = [];

  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeKey,
  });

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      errors.push({
        rowNumber: (e.row ?? 0) + 1,
        field: "_csv",
        message: `CSV parse error: ${e.message}`,
      });
    }
  }

  const data = result.data;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNumber = i + 2; // +1 for 1-index, +1 for header row

    const rowErrors: FixedAssetImportError[] = [];

    const name = (row.nama ?? row.name ?? "").trim();
    if (name.length < 2) {
      rowErrors.push({
        rowNumber,
        field: "nama",
        message: "Nama wajib diisi (min 2 karakter)",
      });
    }

    const category =
      (row.kategori ?? row.category ?? "").trim() || null;

    const cost = parseNumberOrNull(row.cost ?? row.biaya);
    if (cost === null || cost <= 0) {
      rowErrors.push({
        rowNumber,
        field: "cost",
        message: "Cost wajib > 0",
      });
    }

    const salvageRaw = parseNumberOrNull(
      row.salvage_value ?? row.salvage ?? row.nilai_sisa,
    );
    const salvageValue = salvageRaw ?? 0;
    if (salvageValue < 0) {
      rowErrors.push({
        rowNumber,
        field: "salvage_value",
        message: "Salvage value tidak boleh negatif",
      });
    }
    if (cost !== null && salvageValue >= cost) {
      rowErrors.push({
        rowNumber,
        field: "salvage_value",
        message: "Salvage harus < cost",
      });
    }

    const usefulLifeMonths = parseNumberOrNull(
      row.useful_life_months ?? row.useful_life ?? row.umur_bulan,
    );
    if (
      usefulLifeMonths === null ||
      usefulLifeMonths < 1 ||
      usefulLifeMonths > 600
    ) {
      rowErrors.push({
        rowNumber,
        field: "useful_life_months",
        message: "Useful life harus 1-600 bulan",
      });
    }

    const acquiredDate = (
      row.acquired_date ??
      row.tanggal_pengadaan ??
      ""
    ).trim();
    if (!isValidIsoDate(acquiredDate)) {
      rowErrors.push({
        rowNumber,
        field: "acquired_date",
        message: "Format tanggal harus YYYY-MM-DD",
      });
    }

    const assetAccountCode = (row.asset_account_code ?? "").trim();
    if (!VALID_ASSET_CODES.includes(assetAccountCode)) {
      rowErrors.push({
        rowNumber,
        field: "asset_account_code",
        message: `Asset account code harus salah satu dari: ${VALID_ASSET_CODES.join(", ")}`,
      });
    }

    const depreciationAccountCode = (
      row.depreciation_account_code ?? ""
    ).trim();
    if (!VALID_DEP_CODES.includes(depreciationAccountCode)) {
      rowErrors.push({
        rowNumber,
        field: "depreciation_account_code",
        message: `Depreciation account code harus salah satu dari: ${VALID_DEP_CODES.join(", ")}`,
      });
    }

    const capitalize = parseBoolish(row.capitalize);

    const paymentMethodRaw =
      (row.payment_method ?? "").trim().toLowerCase() || "transfer_bca";
    if (capitalize && !VALID_PAYMENT_METHODS.includes(paymentMethodRaw)) {
      rowErrors.push({
        rowNumber,
        field: "payment_method",
        message: `Payment method harus salah satu dari: ${VALID_PAYMENT_METHODS.join(", ")} (kalau capitalize=true)`,
      });
    }

    const notes = (row.notes ?? row.catatan ?? "").trim() || null;

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      rowNumber,
      name,
      category,
      cost: cost!,
      salvageValue,
      usefulLifeMonths: usefulLifeMonths!,
      acquiredDate,
      assetAccountCode,
      depreciationAccountCode,
      capitalize,
      paymentMethod: paymentMethodRaw as
        | "cash"
        | "transfer_bca"
        | "transfer_bri"
        | "transfer_other",
      notes,
    });
  }

  return { rows, errors, totalParsed: data.length };
}

/** Generate empty CSV template for Owner download. */
export function fixedAssetCsvTemplate(): string {
  const headers = [
    "nama",
    "kategori",
    "cost",
    "salvage_value",
    "useful_life_months",
    "acquired_date",
    "asset_account_code",
    "depreciation_account_code",
    "capitalize",
    "payment_method",
    "notes",
  ];
  const sampleRow = [
    "Mesin Espresso La Marzocco",
    "Peralatan Bar",
    "50000000",
    "5000000",
    "96",
    "2026-04-15",
    "1203",
    "6503",
    "true",
    "transfer_bca",
    "Serial #LM12345",
  ];
  const emptyRow = [
    "Furniture meja",
    "Furniture",
    "1500000",
    "0",
    "60",
    "2026-05-01",
    "1201",
    "6501",
    "false",
    "",
    "",
  ];
  return Papa.unparse([headers, sampleRow, emptyRow], { newline: "\n" });
}
