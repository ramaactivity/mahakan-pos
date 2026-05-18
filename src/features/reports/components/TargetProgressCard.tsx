"use client";

import { Trophy, TrendingUp, Target } from "lucide-react";
import type { TargetProgressData, TargetScale } from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62ah — Reusable card untuk progress target pendapatan.
 *
 * Dua varian:
 *  - variant="full" — 3 baris (daily / weekly / monthly), pakai di BO Dashboard
 *    + POS mini-dashboard.
 *  - variant="compact" — 1 baris ringkas daily-only, pakai di POS header.
 */

interface TargetProgressCardProps {
  data: TargetProgressData;
  variant?: "full" | "compact";
  /** True kalau viewer Owner/manager (boleh lihat Rupiah). Kasir staff
   *  by default hidden actual rupiah → cuma show pct + bar (motivasi tanpa
   *  expose angka penjualan ke kasir/competitors). Default true. */
  showRupiah?: boolean;
}

function tierColor(pct: number | null): string {
  if (pct == null) return "bg-neutral-300";
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 80) return "bg-amber-500";
  if (pct >= 50) return "bg-orange-400";
  return "bg-red-400";
}

function tierLabel(pct: number | null): string {
  if (pct == null) return "—";
  if (pct >= 100) return "Target tercapai!";
  if (pct >= 80) return "Hampir tercapai";
  if (pct >= 50) return "On track";
  return "Perlu push";
}

function ProgressRow({
  label,
  icon: Icon,
  scale,
  subLabel,
  showRupiah,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  scale: TargetScale;
  subLabel: string;
  showRupiah: boolean;
}) {
  const noTarget = scale.target == null;
  const pct = scale.pct ?? 0;
  const barWidth = Math.min(100, pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="size-4 text-mahakan-green-700" />
          <span className="text-sm font-semibold text-neutral-900">{label}</span>
          <span className="text-[11px] text-neutral-500">{subLabel}</span>
        </div>
        {noTarget ? (
          <span className="text-[11px] text-neutral-500 italic">
            Belum ada target
          </span>
        ) : (
          <span className="text-sm font-bold tabular-nums text-mahakan-green-900">
            {scale.pct}%
          </span>
        )}
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-neutral-200">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            tierColor(scale.pct),
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[11px] text-neutral-600">
        {noTarget ? (
          showRupiah ? (
            <span>{formatRupiah(scale.actual)}</span>
          ) : (
            <span className="italic">Hubungi owner untuk set target</span>
          )
        ) : (
          <>
            {showRupiah ? (
              <span>
                <strong className="text-neutral-900">
                  {formatRupiah(scale.actual)}
                </strong>{" "}
                / {formatRupiah(scale.target ?? 0)}
              </span>
            ) : (
              <span className="font-medium text-neutral-800">
                {tierLabel(scale.pct)}
              </span>
            )}
            {showRupiah && scale.remaining != null ? (
              <span className={cn(scale.remaining <= 0 && "text-emerald-700")}>
                {scale.remaining <= 0
                  ? `+${formatRupiah(Math.abs(scale.remaining))} di atas target`
                  : `Kurang ${formatRupiah(scale.remaining)}`}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function TargetProgressCard({
  data,
  variant = "full",
  showRupiah = true,
}: TargetProgressCardProps) {
  if (variant === "compact") {
    const daily = data.daily;
    const noTarget = daily.target == null;
    const pct = daily.pct ?? 0;
    return (
      <div className="rounded-lg border border-mahakan-green-700/30 bg-gradient-to-r from-mahakan-green-50 to-white px-3 py-2">
        <div className="flex items-center gap-3">
          <Trophy className="size-4 text-mahakan-green-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-800">
                Target Hari Ini
              </span>
              {noTarget ? (
                <span className="text-[10px] text-neutral-500 italic">
                  Belum di-set
                </span>
              ) : (
                <span className="text-xs font-bold tabular-nums text-mahakan-green-900">
                  {daily.pct}%
                </span>
              )}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  tierColor(daily.pct),
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {showRupiah ? (
              <p className="mt-0.5 text-[10px] text-neutral-600 tabular-nums">
                {formatRupiah(daily.actual)} /{" "}
                {daily.target != null ? formatRupiah(daily.target) : "—"}
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] font-medium text-neutral-700">
                {tierLabel(daily.pct)} — semangat!
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* Sesi AE-62ai — denser 3-col layout untuk tablet landscape (Galaxy A7
   * Lite 1340×800). Stack di portrait/mobile. Pre-fix: 3 stacked rows = banyak
   * scroll, lebar kanan kosong. Sekarang 3 col side-by-side di lg breakpoint. */
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Target className="size-5 text-mahakan-green-700" />
        <h3 className="font-semibold text-neutral-900">Target Pendapatan</h3>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ProgressRow
          label="Hari Ini"
          icon={TrendingUp}
          scale={data.daily}
          subLabel={data.daily.dateLabel}
          showRupiah={showRupiah}
        />
        <ProgressRow
          label="Minggu Ini"
          icon={TrendingUp}
          scale={data.weekly}
          subLabel="7 hari terakhir"
          showRupiah={showRupiah}
        />
        <ProgressRow
          label="Bulan Ini"
          icon={Trophy}
          scale={data.monthly}
          subLabel={data.monthly.monthLabel}
          showRupiah={showRupiah}
        />
      </div>
    </div>
  );
}
