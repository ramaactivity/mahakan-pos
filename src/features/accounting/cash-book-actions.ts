"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { fetchCashBook } from "./cash-book";
import type { CashBook } from "./cash-book-pure";
import { fail, ok, type ApiResult } from "./types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Sesi AE-239 — Buku Kas. accountId null = semua kas & bank,
 * undefined = buku pertama (Kas laci). */
export async function getCashBook(input: {
  accountId?: string | null;
  from: string;
  to: string;
}): Promise<ApiResult<CashBook>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi berakhir, silakan login ulang");
  if (!hasPermission(session.user.role, "accounting.report.view")) {
    return fail("FORBIDDEN", "Tidak punya akses Buku Kas");
  }
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to) {
    return fail("VALIDATION", "Rentang tanggal tidak valid");
  }
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000;
  if (days > 366) return fail("VALIDATION", "Rentang maksimal 1 tahun");
  if (typeof input.accountId === "string" && !z.uuid().safeParse(input.accountId).success) {
    return fail("VALIDATION", "Akun tidak valid");
  }
  const book = await fetchCashBook({
    outletId: session.user.outletId,
    accountId: input.accountId,
    from: input.from,
    to: input.to,
  });
  return book ? ok(book) : fail("NOT_FOUND", "Akun kas/bank tidak ditemukan");
}
