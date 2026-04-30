"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import {
  getMonthlyCadence,
  isOk,
  type MonthlyCadenceStatus,
} from "@/features/stock-opname";
import { cn } from "@/lib/utils";

interface OpnameMonthlyBannerProps {
  onTap?: () => void;
}

export function OpnameMonthlyBanner({ onTap }: OpnameMonthlyBannerProps) {
  const [cadence, setCadence] = useState<MonthlyCadenceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMonthlyCadence().then((res) => {
      if (cancelled) return;
      if (isOk(res)) setCadence(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!cadence) return null;

  // 4 states: completed-this-month / active-in-progress /
  // active-pending-review / nothing-yet.
  let tone: "ok" | "warn" | "info";
  let title: string;
  let subtitle: string;
  let Icon = CalendarPlus;
  let cta: string;

  if (cadence.activeStatus === "in_progress") {
    tone = "info";
    Icon = ClipboardList;
    title = `Opname ${cadence.currentMonthLabel} sedang berjalan`;
    subtitle = "Lanjutkan input qty bahan untuk submit untuk review.";
    cta = "Lanjutkan →";
  } else if (cadence.activeStatus === "pending_review") {
    tone = "warn";
    Icon = AlertCircle;
    title = `Opname ${cadence.currentMonthLabel} menunggu review`;
    subtitle =
      "Manager perlu finalize untuk commit selisih ke stok. Buka tab Inventory → Opname.";
    cta = "Buka review →";
  } else if (cadence.hasCompletedThisMonth) {
    tone = "ok";
    Icon = CheckCircle2;
    title = `Opname ${cadence.currentMonthLabel} sudah selesai ✓`;
    subtitle = cadence.lastCompletedAt
      ? `Selesai ${new Date(cadence.lastCompletedAt).toLocaleDateString("id-ID", {
          dateStyle: "medium",
        })}`
      : "Bagus, stok aktual sudah cocok dengan sistem.";
    cta = "Lihat detail →";
  } else {
    tone = "warn";
    Icon = AlertCircle;
    title = `Opname ${cadence.currentMonthLabel} belum dilakukan`;
    subtitle =
      "Stock opname wajib dilakukan tiap awal/akhir bulan. Mulai sekarang, bisa di-pause kapan aja.";
    cta = "Mulai opname →";
  }

  return (
    <Card
      className={cn(
        "transition-colors",
        tone === "ok" && "border-mahakan-green-700/30 bg-mahakan-green-100/20",
        tone === "warn" && "border-warning-500/40 bg-warning-100/30",
        tone === "info" && "border-info-500/40 bg-info-100/30",
        onTap && "cursor-pointer hover:shadow-md",
      )}
      role={onTap ? "button" : undefined}
      tabIndex={onTap ? 0 : undefined}
      onClick={onTap}
      onKeyDown={(e) => {
        if (!onTap) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
    >
      <CardContent className="flex items-center gap-3 py-4">
        <div
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-full",
            tone === "ok" && "bg-mahakan-green-700/15 text-mahakan-green-900",
            tone === "warn" && "bg-warning-500/15 text-warning-500",
            tone === "info" && "bg-info-500/15 text-info-500",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="text-xs text-neutral-600">{subtitle}</p>
        </div>
        {onTap ? (
          <div className="flex items-center gap-1 text-xs font-medium text-neutral-700">
            {cta}
            <ChevronRight className="size-4" aria-hidden />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
