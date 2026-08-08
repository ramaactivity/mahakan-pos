"use server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAndSanitize } from "@/lib/server-error";
import { fetchIngredientIntake, type IntakeResult } from "./intake-queries";
import { fail, ok, type ApiResult } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ListIngredientIntakeInput {
  dateFrom: string;
  dateTo: string;
  ingredientId?: string;
  supplierId?: string;
  paymentStatus?: "all" | "paid" | "unpaid";
}

/**
 * Sesi AE-192 — daftar "Masuk Bahan" untuk verifikasi input nota.
 *
 * Hak akses menumpang `inventory.movement.view` (owner/manager/supervisor):
 * isinya riwayat penerimaan bahan, satu kelas dengan tab Pergerakan. Kolom
 * rupiah disembunyikan di UI untuk role tanpa `inventory.cost.view`, sama
 * seperti tab Pergerakan.
 */
export async function listIngredientIntake(
  input: ListIngredientIntakeInput,
): Promise<ApiResult<IntakeResult>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi tidak valid");
  if (!hasPermission(session.user.role, "inventory.movement.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat riwayat masuk bahan");
  }
  if (!DATE_RE.test(input.dateFrom) || !DATE_RE.test(input.dateTo)) {
    return fail("VALIDATION_ERROR", "Format tanggal harus YYYY-MM-DD");
  }
  if (input.dateFrom > input.dateTo) {
    return fail(
      "VALIDATION_ERROR",
      "Tanggal awal tidak boleh melewati tanggal akhir",
    );
  }

  try {
    return ok(
      await fetchIngredientIntake(session.user.outletId, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        ingredientId: input.ingredientId,
        supplierId: input.supplierId,
        paymentStatus: input.paymentStatus ?? "all",
      }),
    );
  } catch (e) {
    const msg = logAndSanitize(
      e,
      "listIngredientIntake",
      "Gagal memuat riwayat masuk bahan",
    );
    return fail("INTERNAL_ERROR", msg);
  }
}
