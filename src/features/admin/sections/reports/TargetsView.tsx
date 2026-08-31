"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Target as TargetIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  computeProgress,
  getDailySalesReport,
  getSalesRangeReport,
  isOk,
  type ProgressResult,
} from "@/features/reports";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  updateRevenueTargets,
  type Outlet,
} from "@/features/outlets";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReportExportButtons } from "./ReportExportButtons";

function todayWibIso(): string {
  // Hari ini WIB (UTC+7) sebagai YYYY-MM-DD
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

/** Senin minggu ini (WIB), format YYYY-MM-DD. Senin = awal minggu. */
function weekStartWibIso(): string {
  const today = todayWibIso();
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Tanggal 1 bulan ini, WIB. */
function monthStartWibIso(): string {
  return `${todayWibIso().slice(0, 7)}-01`;
}

/** Tanggal 1 Januari tahun ini, WIB. */
function yearStartWibIso(): string {
  return `${todayWibIso().slice(0, 4)}-01-01`;
}

type RevenueState = {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  yearly: number | null;
};

export function TargetsView() {
  const today = useMemo(() => todayWibIso(), []);
  const weekStart = useMemo(() => weekStartWibIso(), []);
  const monthStart = useMemo(() => monthStartWibIso(), []);
  const yearStart = useMemo(() => yearStartWibIso(), []);

  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [revenue, setRevenue] = useState<RevenueState>({
    daily: null,
    weekly: null,
    monthly: null,
    yearly: null,
  });
  const [loading, setLoading] = useState(true);

  // Form state
  const [dailyTarget, setDailyTarget] = useState("");
  const [weeklyTarget, setWeeklyTarget] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");
  const [yearlyTarget, setYearlyTarget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [daily, week, month, year, outletRes] = await Promise.all([
        getDailySalesReport(today),
        getSalesRangeReport(weekStart, today),
        getSalesRangeReport(monthStart, today),
        getSalesRangeReport(yearStart, today),
        getOwnOutlet(),
      ]);
      if (cancelled) return;
      setRevenue({
        daily: isOk(daily) ? daily.data.metrics.revenue : 0,
        weekly: isOk(week) ? week.data.metrics.revenue : 0,
        monthly: isOk(month) ? month.data.metrics.revenue : 0,
        yearly: isOk(year) ? year.data.metrics.revenue : 0,
      });
      if (isOutletOk(outletRes)) {
        setOutlet(outletRes.data);
        const t = outletRes.data.settings?.targets ?? {};
        setDailyTarget(t.dailyRevenue ? String(t.dailyRevenue) : "");
        setWeeklyTarget(t.weeklyRevenue ? String(t.weeklyRevenue) : "");
        setMonthlyTarget(t.monthlyRevenue ? String(t.monthlyRevenue) : "");
        setYearlyTarget(t.yearlyRevenue ? String(t.yearlyRevenue) : "");
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [today, weekStart, monthStart, yearStart]);

  async function onSave() {
    if (saving) return;
    setSaving(true);
    const parseAmount = (s: string): number | undefined => {
      const cleaned = s.replace(/[^\d]/g, "");
      if (!cleaned) return undefined;
      return Number(cleaned);
    };
    const res = await updateRevenueTargets({
      dailyRevenue: parseAmount(dailyTarget),
      weeklyRevenue: parseAmount(weeklyTarget),
      monthlyRevenue: parseAmount(monthlyTarget),
      yearlyRevenue: parseAmount(yearlyTarget),
    });
    setSaving(false);
    if (!isOutletOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setOutlet(res.data);
    toast.success("Target tersimpan");
  }

  const targets = outlet?.settings?.targets;
  const dailyProgress = computeProgress(revenue.daily ?? 0, targets?.dailyRevenue);
  const weeklyProgress = computeProgress(
    revenue.weekly ?? 0,
    targets?.weeklyRevenue,
  );
  const monthlyProgress = computeProgress(
    revenue.monthly ?? 0,
    targets?.monthlyRevenue,
  );
  const yearlyProgress = computeProgress(
    revenue.yearly ?? 0,
    targets?.yearlyRevenue,
  );

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">
          Target & Progress
        </h2>
        <p className="text-xs text-neutral-500">
          Set target rupiah untuk acuan harian, mingguan, bulanan, dan tahunan.
          Progress dihitung otomatis dari penjualan WIB.
        </p>
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TargetIcon className="size-4" /> Set Target
              </CardTitle>
              <CardDescription>
                Target dipakai untuk indikator progress. Kosongkan kalau belum
                perlu. Hanya owner yang bisa edit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <RpInput
                  label="Target Harian"
                  value={dailyTarget}
                  onChange={setDailyTarget}
                  hint="Reset tiap pukul 00:00 WIB"
                />
                <RpInput
                  label="Target Mingguan"
                  value={weeklyTarget}
                  onChange={setWeeklyTarget}
                  hint="Senin – Minggu (WIB)"
                />
                <RpInput
                  label="Target Bulanan"
                  value={monthlyTarget}
                  onChange={setMonthlyTarget}
                  hint="Tanggal 1 – akhir bulan"
                />
                <RpInput
                  label="Target Tahunan"
                  value={yearlyTarget}
                  onChange={setYearlyTarget}
                  hint="1 Januari – 31 Desember"
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] text-neutral-500">
                  {targets?.updatedAt
                    ? `Terakhir diperbarui ${new Date(targets.updatedAt).toLocaleString("id-ID")}`
                    : "Belum pernah disimpan."}
                </p>
                <Button onClick={onSave} disabled={saving}>
                  <Save className="size-4" />
                  {saving ? "Menyimpan..." : "Simpan Target"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <ReportExportButtons
              filenameBase={`target-progress-${today}`}
              buildSheets={() => [
                {
                  name: "Target & Progress",
                  rows: [
                    { label: "Hari Ini", periode: today, p: dailyProgress },
                    {
                      label: "Minggu Ini",
                      periode: `${weekStart} s/d ${today}`,
                      p: weeklyProgress,
                    },
                    {
                      label: "Bulan Ini",
                      periode: `${monthStart} s/d ${today}`,
                      p: monthlyProgress,
                    },
                    {
                      label: "Tahun Ini",
                      periode: `${yearStart} s/d ${today}`,
                      p: yearlyProgress,
                    },
                  ].map((r) => ({
                    Periode: r.label,
                    Rentang: r.periode,
                    Target: r.p.target,
                    Realisasi: r.p.revenue,
                    "Selisih (realisasi − target)": r.p.delta,
                    "Capaian (%)": r.p.pct ?? "",
                  })),
                },
              ]}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ProgressCard
              title="Progress Hari Ini"
              periodLabel={today}
              progress={dailyProgress}
            />
            <ProgressCard
              title="Progress Minggu Ini"
              periodLabel={`${weekStart} → ${today}`}
              progress={weeklyProgress}
            />
            <ProgressCard
              title="Progress Bulan Ini"
              periodLabel={`${monthStart} → ${today}`}
              progress={monthlyProgress}
              showLinearProjection
            />
            <ProgressCard
              title="Progress Tahun Ini"
              periodLabel={`${yearStart} → ${today}`}
              progress={yearlyProgress}
            />
          </div>
        </>
      )}
    </div>
  );
}

function RpInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  function format(s: string): string {
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("id-ID");
  }
  return (
    <div className="space-y-1">
      <Input
        label={label}
        type="text"
        inputMode="numeric"
        value={value ? format(value) : ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="Rp 0"
      />
      {hint ? (
        <p className="text-[10px] text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

function ProgressCard({
  title,
  periodLabel,
  progress,
  showLinearProjection,
}: {
  title: string;
  periodLabel: string;
  progress: ProgressResult;
  showLinearProjection?: boolean;
}) {
  const { tier, pct, target, revenue, delta } = progress;
  const barPct = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const colors = {
    on_track: "bg-mahakan-green-700",
    needs_push: "bg-warning-500",
    behind: "bg-danger-500",
    no_target: "bg-neutral-300",
  };
  const tierLabel = {
    on_track: "On Track",
    needs_push: "Perlu Genjot",
    behind: "Di Bawah Target",
    no_target: "Belum ada target",
  };
  const tierBg = {
    on_track: "bg-mahakan-green-50 text-mahakan-green-900",
    needs_push: "bg-warning-50 text-warning-500",
    behind: "bg-danger-100 text-danger-500",
    no_target: "bg-neutral-100 text-neutral-500",
  };

  // Linear projection for monthly (revenue / day-of-month * total days)
  let projection: number | null = null;
  if (showLinearProjection && tier !== "no_target" && revenue > 0) {
    const today = todayWibIso();
    const day = Number(today.slice(8, 10));
    const monthLast = new Date(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)),
      0,
    ).getDate();
    projection = Math.round((revenue / day) * monthLast);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
              tierBg[tier],
            )}
          >
            {tierLabel[tier]}
          </span>
        </div>
        <CardDescription>{periodLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="font-mono text-xl font-bold text-neutral-900">
              {formatRupiah(revenue)}
            </p>
            <p className="text-xs text-neutral-500">
              {tier === "no_target"
                ? "Set target di atas untuk lihat progress."
                : `dari target ${formatRupiah(target)}`}
            </p>
          </div>
          {tier !== "no_target" && pct != null ? (
            <div className="text-right">
              <p
                className={cn(
                  "font-mono text-2xl font-bold",
                  tier === "on_track"
                    ? "text-mahakan-green-700"
                    : tier === "needs_push"
                      ? "text-warning-500"
                      : "text-danger-500",
                )}
              >
                {pct.toFixed(1)}%
              </p>
              <p className="text-xs text-neutral-500">
                {delta >= 0 ? "Surplus " : "Kurang "}
                {formatRupiah(Math.abs(delta))}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-3 h-3 overflow-hidden rounded-full bg-neutral-100">
          <div
            className={cn("h-full rounded-full transition-all", colors[tier])}
            style={{ width: `${barPct}%` }}
          />
        </div>

        {projection != null && target > 0 ? (
          <p className="mt-2 text-[11px] text-neutral-500">
            Estimasi akhir bulan (linear):{" "}
            <span className="font-mono font-semibold text-neutral-700">
              {formatRupiah(projection)}
            </span>{" "}
            ({Math.round((projection / target) * 100)}% target)
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
