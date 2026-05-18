"use client";

import { useMemo } from "react";
import { Flame, PartyPopper, Sparkles, Target } from "lucide-react";
import type { TargetProgressData } from "@/features/reports";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62aj — Motivasi banner POS Dashboard.
 *
 * Tampilkan pesan + tip upselling sesuai tier pencapaian daily target.
 * Bahasa santai kasual ala kafe (yuk, gas, ayo), bukan corporate hr-speak.
 * Tip rotates per refresh supaya nggak boring.
 */

type Tier = "no_target" | "early" | "behind" | "ontrack" | "almost" | "hit" | "over";

interface MotivasiCopy {
  /** Headline emoji + 1-line punch. */
  emoji: string;
  headline: string;
  /** Body 1 baris konteks. */
  body: string;
  /** 2-3 tip upselling konkret untuk kasir. */
  tips: string[];
  /** Tailwind classes untuk tone (bg gradient + border + text). */
  tone: {
    container: string;
    headlineText: string;
    iconBg: string;
    iconText: string;
  };
  /** Icon dari lucide. */
  Icon: React.ComponentType<{ className?: string }>;
}

const TIPS_LOW: string[] = [
  "Upsell add-on dessert (Donut, Croffle) tiap pesan kopi ☕ + 🧁",
  "Tawarin upgrade size: regular → large cuma +Rp 5k",
  "Suggest combo paket hemat — makan + minum lebih untung",
  "Recommend menu signature kalau customer bingung baca menu",
  "Tag-on extra shot atau syrup buat kopi (margin tinggi)",
  "Kasi sample mini ke meja yang lagi nunggu — induce craving",
];

const TIPS_MID: string[] = [
  "Tetap konsisten — recommend best-seller hari ini ke customer baru",
  "Push add-on di transaksi solo (1 menu doang) → coba complete-the-meal",
  "Reminder ke regular: ada menu baru / promo bundle apa hari ini",
  "Cross-sell: yang pesan kopi → tawarin pastry, yang makanan → tawarin minuman",
];

const TIPS_HIGH: string[] = [
  "Hampir tembus! Push 1-2 order lagi pasti dapet 🏆",
  "Tawarin take-away buat customer yang udah selesai — extra order",
  "Last push: rekomendasi minuman buat yang udah selesai makan",
];

function pickTip(tips: string[]): string {
  // Pseudo-random tapi stable per render — pakai jam supaya rotate tiap jam.
  const hour = new Date().getHours();
  return tips[hour % tips.length];
}

function tierFromPct(pct: number | null): Tier {
  if (pct == null) return "no_target";
  if (pct >= 120) return "over";
  if (pct >= 100) return "hit";
  if (pct >= 80) return "almost";
  if (pct >= 50) return "ontrack";
  if (pct >= 25) return "behind";
  return "early";
}

function copyForTier(tier: Tier, hourWib: number): MotivasiCopy {
  const isMorning = hourWib < 11;
  const isAfternoon = hourWib >= 11 && hourWib < 16;
  const isEvening = hourWib >= 16;

  const lowTone = {
    container:
      "border-amber-300/60 bg-gradient-to-r from-amber-50 via-amber-50/60 to-white",
    headlineText: "text-amber-900",
    iconBg: "bg-amber-100",
    iconText: "text-amber-600",
  };
  const midTone = {
    container:
      "border-mahakan-green-700/30 bg-gradient-to-r from-mahakan-green-50 via-mahakan-green-50/60 to-white",
    headlineText: "text-mahakan-green-900",
    iconBg: "bg-mahakan-green-100",
    iconText: "text-mahakan-green-700",
  };
  const highTone = {
    container:
      "border-emerald-300/60 bg-gradient-to-r from-emerald-50 via-emerald-50/60 to-white",
    headlineText: "text-emerald-900",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
  };
  const winTone = {
    container:
      "border-emerald-500/60 bg-gradient-to-r from-emerald-100 via-emerald-50 to-amber-50",
    headlineText: "text-emerald-900",
    iconBg: "bg-emerald-200",
    iconText: "text-emerald-800",
  };

  switch (tier) {
    case "no_target":
      return {
        emoji: "🎯",
        headline: "Target belum di-set",
        body: "Bilang owner buat set target di Back Office — biar ada acuan jualan harian.",
        tips: [
          "Sambil nunggu target, fokus: senyum + upsell add-on di setiap order",
          "Catat menu yang sering ditanyain customer — input ke kasir kalau baru",
        ],
        tone: midTone,
        Icon: Target,
      };
    case "early":
      return {
        emoji: "☕",
        headline: isMorning
          ? "Pagi cerah, yuk gas warmup!"
          : isAfternoon
            ? "Masih awal, hari masih panjang"
            : "Sore masih sempat — last push 1 jam lagi",
        body: "Customer baru pada masuk, sekarang waktunya upsell konsisten tiap order.",
        tips: TIPS_LOW,
        tone: lowTone,
        Icon: Sparkles,
      };
    case "behind":
      return {
        emoji: "💪",
        headline: isEvening
          ? "Tinggal beberapa jam, full speed!"
          : "Masih bisa kejar, ayo!",
        body: "Pace agak slow tapi belum game over. Push add-on di tiap transaksi.",
        tips: TIPS_LOW,
        tone: lowTone,
        Icon: Flame,
      };
    case "ontrack":
      return {
        emoji: "🚀",
        headline: "On track, pertahanin!",
        body: "Sudah lebih dari setengah jalan. Konsisten upsell sampai tutup.",
        tips: TIPS_MID,
        tone: midTone,
        Icon: Sparkles,
      };
    case "almost":
      return {
        emoji: "🔥",
        headline: "Hampir tembus — 1-2 order lagi!",
        body: "Tinggal dikit, jangan slow down. Push customer yang udah duduk lama buat tambah pesanan.",
        tips: TIPS_HIGH,
        tone: highTone,
        Icon: Flame,
      };
    case "hit":
      return {
        emoji: "🎉",
        headline: "TARGET TEMBUS! Kerja bagus tim!",
        body: "Mantap, kerjaan lo hari ini gokil. Sekarang every extra Rupiah = bonus margin.",
        tips: [
          "Tetap kasih service maksimal — customer happy = repeat order",
          "Mode chill: fokus quality control + bersihin meja cepet",
          "Catat menu yang habis duluan buat reorder besok pagi",
        ],
        tone: winTone,
        Icon: PartyPopper,
      };
    case "over":
      return {
        emoji: "🏆",
        headline: "OVER TARGET! Champion mode aktif!",
        body: "Lo udah lewat target — every transaksi sekarang full bonus. Keep going!",
        tips: [
          "Day record possible — push terus sampai tutup",
          "Bagikan vibes positif ke tim — momentum harus dijaga",
        ],
        tone: winTone,
        Icon: PartyPopper,
      };
  }
}

export function MotivasiBanner({ data }: { data: TargetProgressData }) {
  const pct = data.daily.pct;
  const hourWib = useMemo(() => {
    /* WIB hour for context-aware copy (pagi/siang/sore). */
    const now = new Date();
    return (now.getUTCHours() + 7) % 24;
  }, []);

  const tier = tierFromPct(pct);
  const copy = useMemo(() => copyForTier(tier, hourWib), [tier, hourWib]);
  const tip = useMemo(() => pickTip(copy.tips), [copy.tips]);
  const Icon = copy.Icon;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 lg:p-4 transition-colors",
        copy.tone.container,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 rounded-full p-2 lg:p-2.5",
            copy.tone.iconBg,
          )}
        >
          <Icon className={cn("size-4 lg:size-5", copy.tone.iconText)} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-bold lg:text-base",
              copy.tone.headlineText,
            )}
          >
            <span aria-hidden className="mr-1">
              {copy.emoji}
            </span>
            {copy.headline}
            {pct != null ? (
              <span className="ml-2 text-xs font-medium text-neutral-600">
                ({pct}% target)
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-neutral-700 lg:text-sm">
            {copy.body}
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-xs lg:text-[13px]">
            <span aria-hidden className="text-base leading-none">
              💡
            </span>
            <span className="font-medium text-neutral-800">{tip}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
