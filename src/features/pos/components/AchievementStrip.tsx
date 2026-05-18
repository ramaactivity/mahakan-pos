"use client";

import { Award, Crown, Flame, Sparkles, Star, Trophy } from "lucide-react";
import type { TargetProgressData } from "@/features/reports";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62aj — Gamify sederhana untuk POS Dashboard.
 *
 * Tampilkan:
 *  - "Achievement chips" yang ke-unlock saat target tercapai (daily / weekly / monthly).
 *  - Status rank berdasarkan progress monthly target.
 *  - Special celebration banner kalau ada yang tercapai (selamat ucapan).
 *
 * Tanpa DB persistence — semua derived dari TargetProgressData. Gamify
 * "sederhana" per owner directive: tidak mengubah core flow, cuma visual
 * motivational layer di atas.
 */

interface AchievementBadge {
  label: string;
  emoji: string;
  Icon: React.ComponentType<{ className?: string }>;
  earned: boolean;
  pct: number | null;
}

interface RankInfo {
  label: string;
  emoji: string;
  description: string;
  tone: string; // tailwind classes
}

function rankForMonthly(pct: number | null): RankInfo {
  if (pct == null) {
    return {
      label: "Trainee",
      emoji: "🌱",
      description: "Target belum di-set",
      tone: "bg-neutral-100 text-neutral-700 ring-neutral-300",
    };
  }
  if (pct >= 100) {
    return {
      label: "Legend",
      emoji: "🏆",
      description: "Target bulanan tembus!",
      tone:
        "bg-gradient-to-r from-amber-100 to-emerald-100 text-amber-900 ring-amber-400",
    };
  }
  if (pct >= 80) {
    return {
      label: "Champion",
      emoji: "👑",
      description: "Hampir banget, almost there!",
      tone: "bg-emerald-100 text-emerald-900 ring-emerald-400",
    };
  }
  if (pct >= 50) {
    return {
      label: "Hero",
      emoji: "💪",
      description: "On track, terus push!",
      tone: "bg-mahakan-green-100 text-mahakan-green-900 ring-mahakan-green-500",
    };
  }
  if (pct >= 25) {
    return {
      label: "Rising",
      emoji: "⭐",
      description: "Mulai naik, kejar terus!",
      tone: "bg-amber-100 text-amber-900 ring-amber-400",
    };
  }
  return {
    label: "Warming Up",
    emoji: "🔥",
    description: "Awal bulan, gas pelan-pelan",
    tone: "bg-orange-100 text-orange-900 ring-orange-400",
  };
}

export function AchievementStrip({ data }: { data: TargetProgressData }) {
  const badges: AchievementBadge[] = [
    {
      label: "Target Hari",
      emoji: "🎯",
      Icon: Star,
      pct: data.daily.pct,
      earned: data.daily.pct != null && data.daily.pct >= 100,
    },
    {
      label: "Target Minggu",
      emoji: "🏅",
      Icon: Award,
      pct: data.weekly.pct,
      earned: data.weekly.pct != null && data.weekly.pct >= 100,
    },
    {
      label: "Target Bulan",
      emoji: "🏆",
      Icon: Trophy,
      pct: data.monthly.pct,
      earned: data.monthly.pct != null && data.monthly.pct >= 100,
    },
    {
      label: "Over Target",
      emoji: "🔥",
      Icon: Flame,
      pct: data.daily.pct,
      /* Earned kalau salah satu scale > 120%. */
      earned:
        (data.daily.pct ?? 0) >= 120 ||
        (data.weekly.pct ?? 0) >= 120 ||
        (data.monthly.pct ?? 0) >= 120,
    },
  ];

  const earnedCount = badges.filter((b) => b.earned).length;
  const rank = rankForMonthly(data.monthly.pct);

  /* Celebration banner kalau ada baru-tercapai (>=100% di salah satu scale). */
  const hasCelebration = earnedCount > 0;

  return (
    <div className="space-y-2">
      {hasCelebration ? <CelebrationBanner badges={badges} /> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        {/* Rank chip */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1",
            rank.tone,
          )}
          title={rank.description}
        >
          <span aria-hidden className="text-sm">
            {rank.emoji}
          </span>
          <span>Rank: {rank.label}</span>
        </div>

        <div className="h-5 w-px bg-neutral-200" aria-hidden />

        {/* Achievement chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((b) => (
            <BadgeChip key={b.label} badge={b} />
          ))}
        </div>

        <div className="ml-auto text-[11px] text-neutral-500">
          {earnedCount > 0
            ? `${earnedCount}/${badges.length} achievement unlocked`
            : "Belum ada achievement"}
        </div>
      </div>
    </div>
  );
}

function BadgeChip({ badge }: { badge: AchievementBadge }) {
  const { Icon } = badge;
  if (badge.earned) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-400",
        )}
        title={`${badge.label} ke-unlock (${badge.pct}%)`}
      >
        <span aria-hidden>{badge.emoji}</span>
        <span>{badge.label}</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200"
      title={
        badge.pct != null
          ? `${badge.label} — ${badge.pct}% (belum unlock)`
          : `${badge.label} — target belum di-set`
      }
    >
      <Icon className="size-3 opacity-50" />
      <span className="opacity-70">{badge.label}</span>
    </div>
  );
}

/* Special big celebration banner kalau ada scale yang baru tercapai. */
function CelebrationBanner({ badges }: { badges: AchievementBadge[] }) {
  const dailyHit = badges.find((b) => b.label === "Target Hari")?.earned;
  const weeklyHit = badges.find((b) => b.label === "Target Minggu")?.earned;
  const monthlyHit = badges.find((b) => b.label === "Target Bulan")?.earned;
  const overHit = badges.find((b) => b.label === "Over Target")?.earned;

  let title = "";
  let body = "";
  let emoji = "";

  if (monthlyHit) {
    title = "SELAMAT! Target Bulan Ini TEMBUS!";
    body =
      "Pencapaian luar biasa, tim. Setiap rupiah dari sini adalah bonus margin. Keep going!";
    emoji = "🏆🎉";
  } else if (weeklyHit && dailyHit) {
    title = "Double Achievement! Hari + Minggu Tembus!";
    body = "Mantap, momentum ini harus dijaga sampai akhir bulan!";
    emoji = "🎊✨";
  } else if (weeklyHit) {
    title = "SELAMAT! Target Mingguan TEMBUS!";
    body = "Konsistensi minggu ini gokil. Sekarang lock target harian biar streak naik!";
    emoji = "🏅🎉";
  } else if (dailyHit) {
    title = "SELAMAT! Target Hari Ini TEMBUS!";
    body =
      "Kerja bagus tim! Hari masih jalan, every order extra = full bonus margin.";
    emoji = "🎯🎉";
  } else if (overHit) {
    title = "OVER TARGET! Champion Mode aktif!";
    body = "Lo udah lewat target — push terus sampai tutup!";
    emoji = "🔥💎";
  }

  if (!title) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-emerald-400 bg-gradient-to-r from-amber-50 via-emerald-50 to-amber-50 p-4 shadow-sm">
      {/* Sparkle decoration */}
      <Sparkles
        className="absolute right-3 top-3 size-5 text-amber-400/60"
        aria-hidden
      />
      <Crown
        className="absolute -bottom-2 -right-2 size-16 text-amber-200/40 rotate-12"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <span aria-hidden className="text-3xl leading-none">
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-emerald-900 lg:text-lg">
            {title}
          </p>
          <p className="mt-0.5 text-xs text-emerald-800 lg:text-sm">{body}</p>
        </div>
      </div>
    </div>
  );
}
