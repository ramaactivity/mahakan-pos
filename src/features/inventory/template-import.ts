"use server";

import { and, eq, isNull } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import {
  ingredients,
  ingredientUnits,
  supplierIngredients,
  suppliers,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { resolveLadderToBase } from "@/lib/unit-conversion";
import {
  saveIngredientManager,
  type SaveIngredientManagerInput,
} from "./ingredient-manager-actions";
import { fail, ok, type ApiResult } from "./types";

const SECTION_LABEL: Record<string, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting",
  cleaning: "Cleaning",
};

const TEMPLATE_HEADER = [
  "Nama Bahan",
  "Section",
  "Satuan Dasar",
  "Stok Minimum",
  "Satuan Stok Min",
  "Supplier Utama",
  "Satuan Beli",
  "Harga per Satuan Beli",
  "Konversi 1: Jumlah",
  "Konversi 1: Ke Satuan",
  "Konversi 2: Jumlah (opsional)",
  "Konversi 2: Ke Satuan (opsional)",
];

/**
 * Sesi AE-176 — Import massal template "Kelola Bahan" (Excel/CSV).
 * Owner download template (terisi data sekarang), edit, upload → DB update.
 *
 * Kolom (urut modal): Nama, Section, Satuan Dasar, Stok Minimum, Satuan Stok
 * Min, Supplier Utama, Satuan Beli, Harga per Satuan Beli, Konversi 1 Jumlah,
 * Konversi 1 Ke, Konversi 2 Jumlah, Konversi 2 Ke.
 *
 * Mesin apply = `saveIngredientManager` (1 baris = 1 panggilan) → semua
 * validasi ladder, dual-write, diff supplier, cascade cost, audit, refresh
 * snapshot opname dipakai ulang. Hanya baris BERUBAH yang ditulis.
 */

const SECTION_MAP: Record<string, "kitchen" | "bar" | "supporting" | "cleaning"> =
  {
    kitchen: "kitchen",
    bar: "bar",
    supporting: "supporting",
    cleaning: "cleaning",
  };

export type RowStatus = "create" | "update" | "unchanged" | "error";

export interface PreviewRow {
  rowNum: number;
  name: string;
  status: RowStatus;
  message?: string;
}

export interface ImportPreview {
  rows: PreviewRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    unchanged: number;
    error: number;
  };
}

/* ── Helpers parsing ──────────────────────────────────────────────────── */

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Parse angka ramah Indonesia: number langsung, atau string "1.000,5"/"1000". */
function cellNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(".") && s.includes(",")) {
    // "1.000,5" → ribuan titik, desimal koma.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Bangun peta index kolom dari baris header (toleran urutan/spasi). */
function buildColMap(header: unknown[]): Record<string, number> {
  const norm = header.map((h) => cellStr(h).toLowerCase());
  const find = (pred: (h: string) => boolean) => norm.findIndex(pred);
  return {
    nama: find((h) => h.includes("nama")),
    section: find((h) => h === "section" || h.includes("section")),
    satuanDasar: find((h) => h.includes("satuan dasar")),
    stokMin: find((h) => h.includes("stok minimum")),
    stokMinUnit: find((h) => h.includes("satuan stok")),
    supplier: find((h) => h.includes("supplier")),
    satuanBeli: find((h) => h.includes("satuan beli")),
    harga: find((h) => h.includes("harga")),
    k1j: find((h) => h.includes("konversi 1") && h.includes("jumlah")),
    k1k: find((h) => h.includes("konversi 1") && h.includes("ke")),
    k2j: find((h) => h.includes("konversi 2") && h.includes("jumlah")),
    k2k: find((h) => h.includes("konversi 2") && h.includes("ke")),
  };
}

interface ExistingIngredient {
  id: string;
  unit: string;
  section: string | null;
  reorderThreshold: number | null;
  costPerUnit: number;
}
interface ExistingSupplierRow {
  id: string;
  supplierId: string;
  packUnit: string;
  packSize: number;
  unitCost: number;
  isPrimary: boolean;
  notes: string | null;
}

interface PlanRow {
  rowNum: number;
  name: string;
  status: RowStatus;
  message?: string;
  input?: SaveIngredientManagerInput;
}

/* ── Bangun rencana (dipakai preview & apply) ─────────────────────────── */

async function buildPlan(
  outletId: string,
  aoa: unknown[][],
): Promise<{ rows: PlanRow[] } | { error: string }> {
  if (!aoa || aoa.length < 2) {
    return { error: "File kosong atau tidak ada baris data." };
  }
  const col = buildColMap(aoa[0]);
  if (col.nama < 0 || col.satuanDasar < 0) {
    return {
      error:
        "Header tidak dikenali. Pastikan pakai template (ada kolom 'Nama Bahan' & 'Satuan Dasar').",
    };
  }

  // Peta data existing.
  const ingRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      reorderThreshold: ingredients.reorderThreshold,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        isNull(ingredients.deletedAt),
        eq(ingredients.isPreparation, false),
      ),
    );
  const ingByName = new Map<string, ExistingIngredient>();
  for (const r of ingRows) {
    ingByName.set(r.name.trim().toLowerCase(), {
      id: r.id,
      unit: r.unit,
      section: r.section,
      reorderThreshold: r.reorderThreshold,
      costPerUnit: r.costPerUnit,
    });
  }

  const supRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.outletId, outletId), isNull(suppliers.deletedAt)));
  const supByName = new Map(
    supRows.map((s) => [s.name.trim().toLowerCase(), s.id]),
  );

  const siRows = await db
    .select({
      id: supplierIngredients.id,
      ingredientId: supplierIngredients.ingredientId,
      supplierId: supplierIngredients.supplierId,
      packUnit: supplierIngredients.packUnit,
      packSize: supplierIngredients.packSize,
      unitCost: supplierIngredients.unitCost,
      isPrimary: supplierIngredients.isPrimary,
      notes: supplierIngredients.notes,
    })
    .from(supplierIngredients)
    .where(
      and(
        eq(supplierIngredients.outletId, outletId),
        isNull(supplierIngredients.deletedAt),
      ),
    );
  const siByIng = new Map<string, ExistingSupplierRow[]>();
  for (const r of siRows) {
    const list = siByIng.get(r.ingredientId) ?? [];
    list.push({
      id: r.id,
      supplierId: r.supplierId,
      packUnit: r.packUnit,
      packSize: Number(r.packSize) || 1,
      unitCost: r.unitCost,
      isPrimary: r.isPrimary,
      notes: r.notes,
    });
    siByIng.set(r.ingredientId, list);
  }

  // Default-buy qtyPerBase existing (utk deteksi perubahan ladder).
  const iuRows = await db
    .select({
      ingredientId: ingredientUnits.ingredientId,
      label: ingredientUnits.label,
      qtyPerBase: ingredientUnits.qtyPerBase,
      isDefaultBuy: ingredientUnits.isDefaultBuy,
    })
    .from(ingredientUnits)
    .where(
      and(
        eq(ingredientUnits.outletId, outletId),
        isNull(ingredientUnits.deletedAt),
      ),
    );
  const defBuyByIng = new Map<string, { label: string; qtyPerBase: number }>();
  for (const r of iuRows) {
    if (r.isDefaultBuy)
      defBuyByIng.set(r.ingredientId, {
        label: r.label,
        qtyPerBase: Number(r.qtyPerBase),
      });
  }

  const seenNames = new Set<string>();
  const rows: PlanRow[] = [];

  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i];
    const rowNum = i + 1; // 1-based + header
    const name = cellStr(raw[col.nama]);
    if (!name) continue; // baris kosong → lewati
    const lc = name.toLowerCase();

    const push = (status: RowStatus, message?: string, input?: SaveIngredientManagerInput) =>
      rows.push({ rowNum, name, status, message, input });

    if (seenNames.has(lc)) {
      push("error", "Nama duplikat di file.");
      continue;
    }
    seenNames.add(lc);

    const satuanDasar = cellStr(raw[col.satuanDasar]);
    if (!satuanDasar) {
      push("error", "Satuan Dasar wajib diisi.");
      continue;
    }

    // Section.
    const secStr = cellStr(raw[col.section]).toLowerCase();
    let section: "kitchen" | "bar" | "supporting" | "cleaning" | null = null;
    if (secStr) {
      const m = SECTION_MAP[secStr];
      if (!m) {
        push("error", `Section "${cellStr(raw[col.section])}" tidak valid (Kitchen/Bar/Supporting/Cleaning).`);
        continue;
      }
      section = m;
    }

    // Ladder konversi.
    const satuanBeli = cellStr(raw[col.satuanBeli]);
    const units: SaveIngredientManagerInput["units"] = [];
    if (satuanBeli) {
      const k1j = cellNum(raw[col.k1j]);
      const k1k = cellStr(raw[col.k1k]) || satuanDasar;
      if (k1j === null || k1j <= 0) {
        push("error", "Konversi 1 Jumlah wajib > 0 saat Satuan Beli diisi.");
        continue;
      }
      units.push({ label: satuanBeli, qtyPerRef: k1j, refUnitLabel: k1k });
      const k2j = cellNum(raw[col.k2j]);
      const k2kRaw = cellStr(raw[col.k2k]);
      if (k2j !== null && k2j > 0) {
        const k2k = k2kRaw || satuanDasar;
        units.push({ label: k1k, qtyPerRef: k2j, refUnitLabel: k2k });
      }
    }

    // Validasi rantai (resolve ke satuan dasar).
    let resolved: Map<string, number>;
    try {
      resolved = resolveLadderToBase(
        units.map((u) => ({
          label: u.label,
          qtyPerRef: u.qtyPerRef,
          refUnitLabel: u.refUnitLabel,
        })),
        satuanDasar,
      );
    } catch {
      push(
        "error",
        "Rantai konversi tidak nyambung ke Satuan Dasar. Cek 'Konversi … Ke Satuan' (tujuan akhir harus = Satuan Dasar).",
      );
      continue;
    }

    // Stok minimum → satuan dasar.
    const stokMinVal = cellNum(raw[col.stokMin]);
    let reorderThreshold: number | null = null;
    if (stokMinVal !== null) {
      const stokUnit = cellStr(raw[col.stokMinUnit]) || satuanBeli || satuanDasar;
      const stokUnitLc = stokUnit.toLowerCase();
      const factor =
        stokUnitLc === satuanDasar.toLowerCase()
          ? 1
          : (resolved.get(stokUnitLc) ?? null);
      if (factor === null) {
        push("error", `Satuan Stok Min "${stokUnit}" tidak dikenal (bukan satuan dasar/beli/pack).`);
        continue;
      }
      reorderThreshold = Math.max(0, Math.round(stokMinVal * factor));
    }

    // Supplier + harga.
    const supplierName = cellStr(raw[col.supplier]);
    const harga = cellNum(raw[col.harga]);
    const existing = ingByName.get(lc);
    const existingSuppliers = existing ? (siByIng.get(existing.id) ?? []) : [];

    const supplierPrices: SaveIngredientManagerInput["supplierPrices"] = [];
    if (supplierName) {
      const supplierId = supByName.get(supplierName.toLowerCase());
      if (!supplierId) {
        push("error", `Supplier "${supplierName}" tidak ditemukan (cek tab Referensi).`);
        continue;
      }
      if (harga === null || harga <= 0) {
        push("error", "Harga per Satuan Beli wajib > 0 saat Supplier diisi.");
        continue;
      }
      const buyUnit = satuanBeli || satuanDasar;
      // Pertahankan baris supplier lain (non-primary) supaya tidak hilang.
      for (const ex of existingSuppliers) {
        if (ex.supplierId === supplierId) continue;
        supplierPrices.push({
          id: ex.id,
          supplierId: ex.supplierId,
          buyUnit: ex.packUnit,
          unitCost: Math.max(1, Math.round(ex.unitCost / ex.packSize)),
          isPrimary: false,
          notes: ex.notes,
        });
      }
      const exMatch = existingSuppliers.find((e) => e.supplierId === supplierId);
      supplierPrices.push({
        id: exMatch?.id ?? null,
        supplierId,
        buyUnit,
        unitCost: Math.round(harga),
        isPrimary: true,
        notes: exMatch?.notes ?? null,
      });
    } else {
      // Tak ada supplier di file → pertahankan SEMUA supplier existing apa adanya.
      for (const ex of existingSuppliers) {
        supplierPrices.push({
          id: ex.id,
          supplierId: ex.supplierId,
          buyUnit: ex.packUnit,
          unitCost: Math.max(1, Math.round(ex.unitCost / ex.packSize)),
          isPrimary: ex.isPrimary,
          notes: ex.notes,
        });
      }
    }

    const input: SaveIngredientManagerInput = {
      id: existing?.id ?? null,
      name,
      unit: satuanDasar,
      section,
      reorderThreshold,
      units,
      supplierPrices,
    };

    if (!existing) {
      push("create", "Bahan baru akan dibuat.", input);
      continue;
    }

    // Deteksi perubahan (skip kalau identik supaya cepat & aman).
    const changed = isChanged(
      existing,
      defBuyByIng.get(existing.id) ?? null,
      existingSuppliers,
      {
        unit: satuanDasar,
        section,
        reorderThreshold,
        buyLabel: satuanBeli || null,
        buyQtyPerBase: satuanBeli
          ? (resolved.get((satuanBeli || "").toLowerCase()) ?? null)
          : null,
        supplierName: supplierName || null,
        supplierId: supplierName
          ? (supByName.get(supplierName.toLowerCase()) ?? null)
          : null,
        harga: harga,
      },
    );
    if (changed) push("update", "Akan di-update.", input);
    else push("unchanged", "Tidak ada perubahan.");
  }

  return { rows };
}

/** Bandingkan state file vs DB → true kalau ada beda yang berarti. */
function isChanged(
  existing: ExistingIngredient,
  defBuy: { label: string; qtyPerBase: number } | null,
  existingSuppliers: ExistingSupplierRow[],
  next: {
    unit: string;
    section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
    reorderThreshold: number | null;
    buyLabel: string | null;
    buyQtyPerBase: number | null;
    supplierName: string | null;
    supplierId: string | null;
    harga: number | null;
  },
): boolean {
  if (existing.unit.trim().toLowerCase() !== next.unit.trim().toLowerCase())
    return true;
  if ((existing.section ?? null) !== next.section) return true;
  if ((existing.reorderThreshold ?? null) !== (next.reorderThreshold ?? null))
    return true;

  // Ladder default-buy.
  const exBuyLabel = defBuy?.label?.toLowerCase() ?? null;
  const nextBuyLabel = next.buyLabel?.toLowerCase() ?? null;
  if (exBuyLabel !== nextBuyLabel) return true;
  if (
    next.buyQtyPerBase !== null &&
    defBuy &&
    Math.abs(defBuy.qtyPerBase - next.buyQtyPerBase) > 1e-4
  )
    return true;

  // Supplier utama + harga per buy.
  if (next.supplierId) {
    const exPrimary = existingSuppliers.find((s) => s.isPrimary);
    if (!exPrimary || exPrimary.supplierId !== next.supplierId) return true;
    const exPerBuy = Math.round(exPrimary.unitCost / exPrimary.packSize);
    // exPerBuy mungkin per-base (data lama). Bandingkan via cost_per_unit×qtyPerBase.
    const expectPerBuy =
      next.buyQtyPerBase !== null
        ? Math.round(existing.costPerUnit * next.buyQtyPerBase)
        : Math.round(existing.costPerUnit);
    if (next.harga !== null && Math.abs((next.harga ?? 0) - expectPerBuy) > 1)
      return true;
    // fallback: kalau exPerBuy beda jauh dari harga file.
    if (next.harga !== null && Math.abs((next.harga ?? 0) - exPerBuy) > 1 &&
        Math.abs((next.harga ?? 0) - expectPerBuy) > 1)
      return true;
  }
  return false;
}

/* ── Server actions ───────────────────────────────────────────────────── */

export async function previewKelolaBahanImport(
  aoa: unknown[][],
): Promise<ApiResult<ImportPreview>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, login ulang.");
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola bahan.");
  }
  const plan = await buildPlan(session.user.outletId, aoa);
  if ("error" in plan) return fail("VALIDATION_ERROR", plan.error);

  const summary = {
    total: plan.rows.length,
    create: plan.rows.filter((r) => r.status === "create").length,
    update: plan.rows.filter((r) => r.status === "update").length,
    unchanged: plan.rows.filter((r) => r.status === "unchanged").length,
    error: plan.rows.filter((r) => r.status === "error").length,
  };
  return ok({
    rows: plan.rows.map(({ rowNum, name, status, message }) => ({
      rowNum,
      name,
      status,
      message,
    })),
    summary,
  });
}

export interface ApplyResult {
  applied: number;
  created: number;
  updated: number;
  failed: number;
  errors: { name: string; message: string }[];
}

export async function applyKelolaBahanImport(
  aoa: unknown[][],
): Promise<ApiResult<ApplyResult>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, login ulang.");
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola bahan.");
  }
  const plan = await buildPlan(session.user.outletId, aoa);
  if ("error" in plan) return fail("VALIDATION_ERROR", plan.error);

  const result: ApplyResult = {
    applied: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const row of plan.rows) {
    if ((row.status !== "create" && row.status !== "update") || !row.input)
      continue;
    const res = await saveIngredientManager(row.input);
    if (res.success) {
      result.applied++;
      if (row.status === "create") result.created++;
      else result.updated++;
    } else {
      result.failed++;
      result.errors.push({ name: row.name, message: res.error.message });
    }
  }

  return ok(result);
}

/* ── Export template (terisi data sekarang) ───────────────────────────── */

function tplNum(n: number | null): number | "" {
  if (n == null || !Number.isFinite(n)) return "";
  return Math.round(n * 10000) / 10000;
}

/** Rekonstruksi rantai konversi dari unit flat → maks 2 level intuitif. */
function buildExportChain(
  buy: { label: string; qtyPerBase: number },
  others: { label: string; qtyPerBase: number }[],
  baseUnit: string,
): { jumlah: number; ke: string }[] {
  const levels: { jumlah: number; ke: string }[] = [];
  let current = buy;
  let pool = others.slice().sort((a, b) => b.qtyPerBase - a.qtyPerBase);
  let guard = 0;
  while (guard++ < 6) {
    const next = pool.find(
      (o) =>
        o.qtyPerBase < current.qtyPerBase &&
        Math.abs(current.qtyPerBase % o.qtyPerBase) < 1e-6,
    );
    if (next) {
      levels.push({ jumlah: current.qtyPerBase / next.qtyPerBase, ke: next.label });
      pool = pool.filter((x) => x !== next);
      current = next;
    } else {
      levels.push({ jumlah: current.qtyPerBase, ke: baseUnit });
      break;
    }
  }
  if (levels.length > 2) return [{ jumlah: buy.qtyPerBase, ke: baseUnit }];
  return levels;
}

export async function exportKelolaBahanTemplate(): Promise<
  ApiResult<{ filename: string; base64: string }>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, login ulang.");
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan.");
  }
  const outletId = session.user.outletId;

  const ingRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      section: ingredients.section,
      unit: ingredients.unit,
      reorderThreshold: ingredients.reorderThreshold,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        isNull(ingredients.deletedAt),
        eq(ingredients.isPreparation, false),
        eq(ingredients.isActive, true),
      ),
    )
    .orderBy(ingredients.name);

  const iuRows = await db
    .select({
      ingredientId: ingredientUnits.ingredientId,
      label: ingredientUnits.label,
      qtyPerBase: ingredientUnits.qtyPerBase,
      isDefaultBuy: ingredientUnits.isDefaultBuy,
    })
    .from(ingredientUnits)
    .where(
      and(
        eq(ingredientUnits.outletId, outletId),
        isNull(ingredientUnits.deletedAt),
      ),
    );
  const unitsByIng = new Map<
    string,
    { label: string; qtyPerBase: number; isDefaultBuy: boolean }[]
  >();
  for (const r of iuRows) {
    const list = unitsByIng.get(r.ingredientId) ?? [];
    list.push({
      label: r.label,
      qtyPerBase: Number(r.qtyPerBase),
      isDefaultBuy: r.isDefaultBuy,
    });
    unitsByIng.set(r.ingredientId, list);
  }

  const siRows = await db
    .select({
      ingredientId: supplierIngredients.ingredientId,
      packUnit: supplierIngredients.packUnit,
      supplierName: suppliers.name,
    })
    .from(supplierIngredients)
    .innerJoin(suppliers, eq(suppliers.id, supplierIngredients.supplierId))
    .where(
      and(
        eq(supplierIngredients.outletId, outletId),
        eq(supplierIngredients.isPrimary, true),
        isNull(supplierIngredients.deletedAt),
      ),
    );
  const primaryByIng = new Map<string, { supplierName: string; buyUnit: string }>();
  for (const r of siRows) {
    primaryByIng.set(r.ingredientId, {
      supplierName: r.supplierName,
      buyUnit: r.packUnit,
    });
  }

  const allSup = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.outletId, outletId), isNull(suppliers.deletedAt)))
    .orderBy(suppliers.name);

  const rows: (string | number)[][] = [TEMPLATE_HEADER];
  for (const ing of ingRows) {
    const units = unitsByIng.get(ing.id) ?? [];
    const prim = primaryByIng.get(ing.id);
    const defBuy = units.find((u) => u.isDefaultBuy);
    const buyUnit = defBuy?.label || prim?.buyUnit || "";
    const buyPerBase =
      units.find((u) => u.label.toLowerCase() === buyUnit.toLowerCase())
        ?.qtyPerBase || 1;

    let k1j: number | "" = "",
      k1k = "",
      k2j: number | "" = "",
      k2k = "";
    if (buyUnit) {
      const buy =
        units.find((u) => u.label.toLowerCase() === buyUnit.toLowerCase()) ?? {
          label: buyUnit,
          qtyPerBase: 1,
        };
      const others = units.filter((u) => u !== buy);
      const chain = buildExportChain(buy, others, ing.unit);
      if (chain[0]) {
        k1j = tplNum(chain[0].jumlah);
        k1k = chain[0].ke;
      }
      if (chain[1]) {
        k2j = tplNum(chain[1].jumlah);
        k2k = chain[1].ke;
      }
    }

    const harga =
      prim && ing.costPerUnit > 0 ? Math.round(ing.costPerUnit * buyPerBase) : "";
    const stokMin = ing.reorderThreshold != null ? tplNum(ing.reorderThreshold / buyPerBase) : "";
    const stokMinUnit = ing.reorderThreshold != null ? buyUnit || ing.unit : "";

    rows.push([
      ing.name,
      ing.section ? SECTION_LABEL[ing.section] || ing.section : "",
      ing.unit,
      stokMin,
      stokMinUnit,
      prim?.supplierName || "",
      buyUnit,
      harga,
      k1j,
      k1k,
      k2j,
      k2k,
    ]);
  }

  const petunjuk = [
    ["TEMPLATE KELOLA BAHAN — MAHAKAN POS"],
    [""],
    ["Cara pakai:"],
    ["1. Edit / koreksi tab \"Bahan\" (sudah terisi data sekarang)."],
    ["2. Satu baris = satu bahan. Jangan ubah baris HEADER (baris 1)."],
    ["3. Simpan, lalu upload lewat tombol \"Import Template\" di halaman Inventory."],
    [""],
    ["Penjelasan kolom (urut sesuai modal Kelola Bahan):"],
    ["Nama Bahan", "KUNCI pencocokan — harus sama persis dgn di sistem."],
    ["Section", "Kitchen / Bar / Supporting / Cleaning. Boleh kosong."],
    ["Satuan Dasar", "Satuan terkecil di resep (gr/ml/Pcs/Kg/L/Btl)."],
    ["Stok Minimum", "Batas stok rendah, dalam Satuan Stok Min. Boleh kosong."],
    ["Satuan Stok Min", "Satuan utk Stok Minimum (biasanya = Satuan Beli)."],
    ["Supplier Utama", "Nama supplier utama (lihat tab Referensi). Boleh kosong."],
    ["Satuan Beli", "Satuan saat beli (Kg/renceng/Btl/Pack)."],
    ["Harga per Satuan Beli", "Harga utk 1 Satuan Beli (angka, tanpa Rp/titik)."],
    ["Konversi 1: Jumlah", "1 [Satuan Beli] = berapa [Konversi 1: Ke]."],
    ["Konversi 1: Ke Satuan", "Tujuan konversi 1. Kalau langsung ke dasar, isi Satuan Dasar."],
    ["Konversi 2: Jumlah", "OPSIONAL. 1 [Konversi 1: Ke] = berapa [Konversi 2: Ke]."],
    ["Konversi 2: Ke Satuan", "OPSIONAL. Tujuan AKHIR harus = Satuan Dasar."],
    [""],
    ["Contoh sederhana: Ayam Fillet — Beli=Kg, K1 Jumlah=1000, K1 Ke=gr (K2 kosong)."],
    ["Contoh bertingkat: Chocolatos — Beli=renceng, K1=10 sachet, K2=28 gr (=> 1 renceng=280 gr)."],
    ["Harga = untuk 1 Satuan Beli (mis. 1 renceng=21000), BUKAN per gram."],
  ];
  const referensi: string[][] = [
    ["REFERENSI"],
    [""],
    ["Section valid: Kitchen / Bar / Supporting / Cleaning (boleh kosong)"],
    ["Satuan dasar umum: gr, ml, Pcs, Kg, L, Btl"],
    [""],
    ["Daftar Supplier (pakai nama persis):"],
    ...allSup.map((s) => [s.name]),
  ];

  const wb = XLSX.utils.book_new();
  const wsP = XLSX.utils.aoa_to_sheet(petunjuk);
  wsP["!cols"] = [{ wch: 26 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, wsP, "Petunjuk");
  const wsB = XLSX.utils.aoa_to_sheet(rows);
  wsB["!cols"] = [
    { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 20 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsB, "Bahan");
  const wsR = XLSX.utils.aoa_to_sheet(referensi);
  wsR["!cols"] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsR, "Referensi");

  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return ok({ filename: "Template-Kelola-Bahan-Mahakan.xlsx", base64 });
}
