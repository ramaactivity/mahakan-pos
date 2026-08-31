"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import type { OutletSettings } from "@/db/schema/outlets";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { hashPin, isValidPinFormat, verifyPin } from "@/lib/auth/pin";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-221 — PIN STATIS COMPLIMENT.
 *
 * Menggantikan alur kode 6 digit (AE-195) atas permintaan owner: kasir cukup
 * mengetik satu PIN tetap, tanpa menunggu owner mengirimkan kode.
 *
 * Yang HILANG dengan perubahan ini, supaya tercatat: kode lama membuktikan
 * owner benar-benar menyetujui transaksi ini, dengan alasan dan nilai
 * keranjang yang persis. PIN statis hanya membuktikan bahwa yang mengetik
 * tahu PIN-nya. Jejak audit tetap mencatat kasir, alasan, dan nilainya.
 *
 * Yang TETAP dijaga: verifikasi terjadi di SERVER, di dalam createTransaction
 * dan editOpenBill. PIN tidak pernah dikirim ke perangkat kasir, dan yang
 * tersimpan di pengaturan outlet adalah hash bcrypt — `settings` ikut dibaca
 * perangkat kasir, jadi menyimpannya polos sama dengan membocorkannya.
 */

async function readOutletSettings(outletId: string): Promise<OutletSettings> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  return row?.settings ?? {};
}

/**
 * Cocokkan PIN compliment untuk outlet ini. Dipakai server-side oleh
 * createTransaction & editOpenBill — JANGAN pindahkan ke klien.
 *
 * Mengembalikan `false` juga saat PIN belum pernah diatur: lebih baik
 * compliment tertahan daripada lolos tanpa gerbang sama sekali.
 */
export async function verifyComplimentPinForOutlet(
  outletId: string,
  pin: string | null | undefined,
): Promise<boolean> {
  const candidate = (pin ?? "").trim();
  if (!isValidPinFormat(candidate)) return false;
  const settings = await readOutletSettings(outletId);
  const hash = settings.approval?.complimentPinHash;
  if (!hash) return false;
  return verifyPin(candidate, hash);
}

/**
 * Dipakai modal POS untuk memberi tahu kasir SEKARANG kalau PIN-nya salah,
 * alih-alih membiarkannya gagal di detik terakhir saat menekan Bayar.
 *
 * Ini kenyamanan layar, BUKAN gerbangnya. Gerbang yang sebenarnya tetap di
 * createTransaction — kalau pemeriksaan di sini dilewati, transaksinya tetap
 * ditolak server.
 */
export async function verifyComplimentPin(
  pin: string,
): Promise<ApiResult<{ verified: true }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi tidak ditemukan");
  if (!hasPermission(session.user.role, "pos.compliment.request")) {
    return fail("FORBIDDEN", "Tidak punya hak memberi compliment");
  }
  const okPin = await verifyComplimentPinForOutlet(session.user.outletId, pin);
  if (!okPin) {
    const settings = await readOutletSettings(session.user.outletId);
    if (!settings.approval?.complimentPinHash) {
      return fail(
        "PIN_NOT_SET",
        "PIN compliment belum diatur. Minta Owner mengaturnya di Pengaturan.",
      );
    }
    return fail("PIN_INVALID", "PIN salah");
  }
  return ok({ verified: true });
}

/** Apakah outlet ini sudah punya PIN compliment? Untuk petunjuk di layar. */
export async function getComplimentPinStatus(): Promise<
  ApiResult<{ configured: boolean }>
> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi tidak ditemukan");
  const settings = await readOutletSettings(session.user.outletId);
  return ok({ configured: Boolean(settings.approval?.complimentPinHash) });
}

/** Atur / ganti PIN compliment. Owner saja. */
export async function updateComplimentPin(input: {
  pin: string;
}): Promise<ApiResult<{ configured: true }>> {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", "Sesi tidak ditemukan");
  if (session.user.role !== "owner") {
    return fail("FORBIDDEN", "Hanya Owner yang bisa mengatur PIN compliment");
  }
  const pin = input.pin.trim();
  if (!isValidPinFormat(pin)) {
    return fail("VALIDATION", "PIN harus 4-6 digit angka");
  }

  const settings = await readOutletSettings(session.user.outletId);
  const next: OutletSettings = {
    ...settings,
    approval: {
      ...(settings.approval ?? {}),
      complimentPinHash: await hashPin(pin),
    },
  };
  await db
    .update(outlets)
    .set({ settings: next })
    .where(eq(outlets.id, session.user.outletId));

  /* PIN-nya sendiri TIDAK pernah masuk jejak audit. */
  logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: session.user.outletId,
    payload: { summary: "PIN compliment diubah" },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  }).catch((e) => console.error("[audit compliment pin]", e));

  return ok({ configured: true });
}
