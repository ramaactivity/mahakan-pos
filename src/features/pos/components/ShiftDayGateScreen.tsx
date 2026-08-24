"use client";

import {
  AlertTriangle,
  Clock,
  LogOut,
  Lock,
  ReceiptText,
  ShieldQuestion,
  Wallet,
} from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import type { ShiftDayGateState } from "@/features/shifts";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatRupiah } from "@/lib/format";

interface Props {
  state: ShiftDayGateState;
  /** Sisa jatah penundaan. 0 = tombol tunda tidak boleh muncul lagi. */
  snoozeRemaining: number;
  canSnooze: boolean;
  /** Pesan gagal dari percobaan tutup terakhir (mis. masih ada approval). */
  closeError: string | null;
  onRequestCloseShift: () => void;
  onOpenBills: () => void;
  onSnooze: () => void;
  onEmergency: () => void;
  onLogout: () => void;
}

function headline(state: ShiftDayGateState): { title: string; lead: string } {
  switch (state.reason) {
    case "stale_days":
      return {
        title: `Shift ini sudah menggantung ${state.daysStale} hari`,
        lead: "Tutup dulu sebelum kasir dipakai lagi. Semua penjualan hari ini akan masuk ke shift lama kalau dibiarkan.",
      };
    case "day_rolled":
      return {
        title: "Hari sudah ganti — shift kemarin belum ditutup",
        lead: "Hitung kas di laci lalu tutup shift kemarin. Setelah itu shift hari ini bisa dibuka seperti biasa.",
      };
    case "past_midnight":
    default:
      return {
        title: "Sudah lewat tengah malam",
        lead: "Shift ini dibuka kemarin. Kalau tamu terakhir sudah selesai, tutup sekarang selagi kas masih segar di ingatan.",
      };
  }
}

/**
 * Sesi AE-217 — layar gerbang shift. Dirender MENGGANTI seluruh isi POS
 * (bukan sekadar lapisan di atasnya) supaya tidak ada kasir, keranjang, atau
 * tab yang bisa disentuh selagi shift basi masih terbuka — termasuk lewat
 * pintasan keyboard atau sisa tab yang sudah ter-mount.
 *
 * Tablet Galaxy A7 Lite (1340×800 landskap) jadi acuan: satu kolom tengah,
 * tombol setinggi jempol, tidak ada yang perlu digulir di layar itu.
 */
export function ShiftDayGateScreen({
  state,
  snoozeRemaining,
  canSnooze,
  closeError,
  onRequestCloseShift,
  onOpenBills,
  onSnooze,
  onEmergency,
  onLogout,
}: Props) {
  const { title, lead } = headline(state);
  const shift = state.shift;
  const hasOpenBills = state.openBillCount > 0;
  const isHard = state.level === "hard";

  return (
    <div className="fixed inset-0 z-[45] flex flex-col overflow-y-auto bg-neutral-900/95 p-4 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 py-4">
        <div className="flex items-start gap-3">
          <span
            className={
              isHard
                ? "rounded-full bg-red-500/15 p-3 text-red-300"
                : "rounded-full bg-amber-500/15 p-3 text-amber-300"
            }
          >
            {isHard ? (
              <Lock className="size-7" aria-hidden />
            ) : (
              <AlertTriangle className="size-7" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-neutral-300">{lead}</p>
          </div>
        </div>

        {shift ? (
          <Card>
            <CardContent className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                  <Clock className="size-4 text-neutral-500" aria-hidden />
                  Dibuka {formatIndonesianDateTime(shift.openedAt)} WIB
                </div>
                <Badge variant={isHard ? "danger" : "warning"}>
                  {state.daysStale === 0
                    ? "Hari ini"
                    : state.daysStale === 1
                      ? "Kemarin"
                      : `${state.daysStale} hari lalu`}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-neutral-50 px-3 py-2">
                  <p className="text-xs text-neutral-500">Dibuka oleh</p>
                  <p className="text-sm font-semibold text-neutral-900">
                    {shift.openedByName ?? "Kasir"}
                    {shift.isOwnShift ? " (kamu)" : ""}
                  </p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-3 py-2">
                  <p className="text-xs text-neutral-500">Kas awal</p>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    <Wallet className="size-4 text-neutral-500" aria-hidden />
                    {formatRupiah(shift.openingCash)}
                  </p>
                </div>
              </div>
              {state.daysStale >= 1 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  Kas yang kamu hitung nanti mencakup{" "}
                  {state.daysStale === 1 ? "dua hari" : `${state.daysStale + 1} hari`}{" "}
                  sekaligus, jadi selisihnya wajar kalau besar. Tulis apa adanya
                  di catatan penutup — jangan dikira-kira supaya pas.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {hasOpenBills ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <ReceiptText className="size-4" aria-hidden />
              Ada {state.openBillCount} bill belum dibayar di shift ini
            </p>
            <p className="mt-1 text-xs text-amber-100/80">
              Shift tidak bisa ditutup selama masih ada bill terbuka. Bayar atau
              batalkan dulu dari daftar di bawah.
            </p>
          </div>
        ) : null}

        {closeError ? (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {closeError}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {hasOpenBills ? (
            <>
              <Button size="lg" className="w-full" onClick={onOpenBills}>
                <ReceiptText className="size-5" aria-hidden />
                Selesaikan {state.openBillCount} Bill Dulu
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled
                title="Bereskan bill terbuka dulu"
              >
                <Lock className="size-5" aria-hidden /> Tutup Shift Sekarang
              </Button>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={onRequestCloseShift}>
              <Lock className="size-5" aria-hidden /> Tutup Shift Sekarang
            </Button>
          )}

          {canSnooze ? (
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              onClick={onSnooze}
            >
              Masih ada tamu — ingatkan lagi{" "}
              {state.thresholds.snoozeMinutes} menit
              <span className="ml-1 text-xs opacity-70">
                (sisa {snoozeRemaining}×)
              </span>
            </Button>
          ) : null}
        </div>

        {state.level === "soft" ? (
          <p className="text-center text-xs text-neutral-400">
            Kalau belum ditutup juga, POS terkunci otomatis pukul{" "}
            {state.thresholds.hardLockAt} WIB.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <button
            type="button"
            onClick={onEmergency}
            className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 underline-offset-4 hover:underline"
          >
            <ShieldQuestion className="size-4" aria-hidden />
            Tidak tahu kas shift ini?
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs font-medium text-neutral-400 underline-offset-4 hover:underline"
          >
            <LogOut className="size-4" aria-hidden />
            Keluar
          </button>
        </div>
      </div>
    </div>
  );
}
