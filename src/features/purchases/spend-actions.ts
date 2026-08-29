"use server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAndSanitize } from "@/lib/server-error";
import {
  fetchPendingOrderTotals,
  fetchSpendLines,
  resolveSpendRange,
} from "./spend-queries";
import {
  buildSpendRecap,
  matchesSpendFilters,
  type SpendDateBasis,
  type SpendDimension,
  type SpendFilters,
  type SpendLine,
  type SpendRecapResult,
} from "./spend-recap-pure";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-222 — Rekap Pembelanjaan bahan baku (rupiah).
 *
 * Satu panggilan mengembalikan SEMUA dimensi rincian (bulan/tanggal/section/
 * bahan/supplier/metode) sekaligus. Alasannya: tiap dimensi hanya puluhan
 * baris, sementara mengganti "rincikan per" adalah hal yang paling sering
 * dilakukan owner. Kalau tiap pergantian memicu query, layarnya berkedip
 * tanpa alasan.
 */

export interface SpendRecapRequest {
  dateFrom: string;
  dateTo: string;
  dateBasis?: SpendDateBasis;
  filters?: SpendFilters;
}

export interface SpendDetailRequest extends SpendRecapRequest {
  /** Batasi ke satu kelompok hasil rekap, mis. bahan tertentu. */
  dimension?: SpendDimension;
  dimensionKey?: string;
  limit?: number;
}

const MAX_RANGE_DAYS = 800;

function sanitizeRange(
  dateFrom: string,
  dateTo: string,
): { from: string; to: string } | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(dateFrom) || !iso.test(dateTo)) return null;
  if (dateTo < dateFrom) return null;
  return { from: dateFrom, to: dateTo };
}

export async function getPurchaseSpendRecap(
  req: SpendRecapRequest,
): Promise<ApiResult<SpendRecapResult>> {
  try {
    const session = await auth();
    if (!session) return fail("UNAUTHORIZED", "Sesi tidak ditemukan");
    if (!hasPermission(session.user.role, "purchase.view")) {
      return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
    }

    const range = sanitizeRange(req.dateFrom, req.dateTo);
    if (!range) return fail("VALIDATION", "Rentang tanggal tidak valid");

    const dateBasis: SpendDateBasis =
      req.dateBasis === "purchase" ? "purchase" : "receipt";
    const outletId = session.user.outletId;

    const resolved = await resolveSpendRange(outletId, range.from, range.to);
    /* Rem beban: rentang ngawur (mis. salah ketik tahun) bisa menarik puluhan
     * ribu baris. Batasi ke ~2 tahun. */
    const spanDays =
      (Date.parse(`${resolved.to}T00:00:00Z`) -
        Date.parse(`${resolved.from}T00:00:00Z`)) /
      86_400_000;
    if (spanDays > MAX_RANGE_DAYS) {
      return fail(
        "VALIDATION",
        `Rentang terlalu panjang (maks ${MAX_RANGE_DAYS} hari). Persempit tanggalnya.`,
      );
    }

    const [current, previous, pendingOrders] = await Promise.all([
      fetchSpendLines(outletId, {
        dateFrom: resolved.from,
        dateTo: resolved.to,
        dateBasis,
      }),
      resolved.previous
        ? fetchSpendLines(outletId, {
            dateFrom: resolved.previous.from,
            dateTo: resolved.previous.to,
            dateBasis,
          })
        : Promise.resolve({ lines: [] as SpendLine[], truncated: false }),
      fetchPendingOrderTotals(outletId),
    ]);

    return ok(
      buildSpendRecap({
        lines: current.lines,
        previousLines: previous.lines,
        filters: req.filters ?? {},
        range: { from: resolved.from, to: resolved.to },
        previousRange: resolved.previous,
        pendingOrders,
        truncated: current.truncated,
        cutoffApplied: resolved.cutoffApplied,
        dateBasis,
      }),
    );
  } catch (e) {
    return fail("SERVER_ERROR", logAndSanitize(e, "getPurchaseSpendRecap", "Gagal memuat rekap pembelanjaan"));
  }
}

/**
 * Baris mentah di balik satu angka rekap — dipakai saat owner mengklik satu
 * baris ("kenapa kopi bulan ini Rp 4 juta?"). Angka yang tidak bisa dibuka
 * isinya cuma jadi bahan curiga.
 */
export async function listPurchaseSpendDetail(
  req: SpendDetailRequest,
): Promise<ApiResult<{ lines: SpendLine[]; truncated: boolean; total: number }>> {
  try {
    const session = await auth();
    if (!session) return fail("UNAUTHORIZED", "Sesi tidak ditemukan");
    if (!hasPermission(session.user.role, "purchase.view")) {
      return fail("FORBIDDEN", "Tidak punya hak lihat pembelian");
    }

    const range = sanitizeRange(req.dateFrom, req.dateTo);
    if (!range) return fail("VALIDATION", "Rentang tanggal tidak valid");

    const dateBasis: SpendDateBasis =
      req.dateBasis === "purchase" ? "purchase" : "receipt";
    const outletId = session.user.outletId;
    const resolved = await resolveSpendRange(outletId, range.from, range.to);

    const { lines, truncated } = await fetchSpendLines(outletId, {
      dateFrom: resolved.from,
      dateTo: resolved.to,
      dateBasis,
    });

    const filters = req.filters ?? {};
    let picked = lines.filter((l) => matchesSpendFilters(l, filters));

    if (req.dimension && req.dimensionKey !== undefined) {
      const key = req.dimensionKey;
      picked = picked.filter((l) => {
        switch (req.dimension) {
          case "month":
            return l.date.slice(0, 7) === key;
          case "date":
            return l.date === key;
          case "section":
            return l.section === key;
          case "ingredient":
            return l.ingredientId === key;
          case "supplier":
            return (l.supplierId ?? "__none__") === key;
          case "paymentMethod":
            return l.paymentMethod === key;
          default:
            return true;
        }
      });
    }

    const total = picked.reduce((s, l) => s + l.amount, 0);
    picked.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));
    const cap = Math.min(Math.max(req.limit ?? 500, 1), 2000);
    return ok({
      lines: picked.slice(0, cap),
      truncated: truncated || picked.length > cap,
      total,
    });
  } catch (e) {
    return fail("SERVER_ERROR", logAndSanitize(e, "listPurchaseSpendDetail", "Gagal memuat rincian pembelanjaan"));
  }
}
