"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  Coffee,
  RefreshCw,
} from "lucide-react";
import { Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { getMyScheduleWeek, isOk } from "@/features/schedules";
import type { EmployeeSchedule } from "@/features/schedules/types";
import { cn } from "@/lib/utils";

const DAY_LABELS_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DAY_LABELS_LONG = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/**
 * Sesi AD-12 — Jadwal Kerja mobile module.
 *
 * Karyawan lihat jadwalnya sendiri per minggu (Sen–Min). Auth via
 * NextAuth session, fetch via getMyScheduleWeek (staff-scoped, no
 * admin permission). Navigation: prev / today / next week. Sticky
 * "Hari Ini" highlight kalau date row = today di WIB.
 *
 * Empty / unlinked states:
 *   - User session tapi employees.userId blank → "Akun belum di-link"
 *     (pakai action error message, bukan empty state).
 *   - Employee linked tapi week tidak ada entry → "Belum di-set untuk
 *     minggu ini" + arah ke owner / Back Office.
 */
export default function MobileJadwalPage() {
  const router = useRouter();
  const { session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/m/login");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }
  if (status === "unauthenticated" || !session) return null;

  return <JadwalView />;
}

function JadwalView() {
  const todayKey = useMemo(() => isoDateInWib(new Date()), []);
  const [weekStart, setWeekStart] = useState<string>(() =>
    weekStartFor(new Date()),
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<{
    employeeName: string;
    weekStart: string;
    weekEnd: string;
    entries: EmployeeSchedule[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Fetch on mount, on week change, and when refreshTick bumped via the
  // header refresh button. setState only happens AFTER the await — keeps
  // react-hooks/set-state-in-effect happy.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getMyScheduleWeek({ weekStart });
      if (cancelled) return;
      if (isOk(res)) {
        setData(res.data);
        setErrorMsg(null);
        setErrorCode(null);
      } else {
        setData(null);
        setErrorMsg(res.error.message);
        setErrorCode(res.error.code);
      }
      setLoading(false);
      setRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, refreshTick]);

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((n) => n + 1);
  }, []);

  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const entriesByDate = useMemo(() => {
    const map = new Map<string, EmployeeSchedule>();
    for (const e of data?.entries ?? []) map.set(e.scheduleDate, e);
    return map;
  }, [data]);

  const isCurrentWeek = weekStart === weekStartFor(new Date());

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <Link
          href="/m"
          aria-label="Kembali"
          className="inline-flex size-10 items-center justify-center rounded-lg text-neutral-700 active:bg-neutral-100"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex flex-1 flex-col items-center text-center">
          <h1 className="text-base font-bold text-mahakan-green-900">
            Jadwal Kerja
          </h1>
          {data?.employeeName ? (
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              {data.employeeName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={triggerRefresh}
          aria-label="Refresh"
          className="inline-flex size-10 items-center justify-center rounded-lg text-neutral-700 active:bg-neutral-100"
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={cn(
              "size-5 transition-transform",
              refreshing && "animate-spin",
            )}
          />
        </button>
      </header>

      <WeekNav
        weekStart={weekStart}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onToday={() => {
          const today = weekStartFor(new Date());
          if (today === weekStart) {
            toast.info("Sudah di minggu ini");
            return;
          }
          setWeekStart(today);
        }}
        isCurrentWeek={isCurrentWeek}
      />

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : errorMsg ? (
        <ErrorPanel code={errorCode} message={errorMsg} />
      ) : (
        <DayList
          days={days}
          todayKey={todayKey}
          entriesByDate={entriesByDate}
        />
      )}

      <footer className="pt-2 text-center text-[11px] text-neutral-500">
        Jadwal di-set HR / owner di Back Office. Kalau ada ketidakcocokan,
        konfirmasi dulu sebelum hari kerja.
      </footer>
    </div>
  );
}

function WeekNav({
  weekStart,
  onPrev,
  onNext,
  onToday,
  isCurrentWeek,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrentWeek: boolean;
}) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = `${start.getUTCDate()} ${MONTH_LABELS[start.getUTCMonth()]}`;
  const endLabel = sameMonth
    ? `${end.getUTCDate()}`
    : `${end.getUTCDate()} ${MONTH_LABELS[end.getUTCMonth()]}`;
  const yearLabel = end.getUTCFullYear();

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-2 py-2 shadow-sm">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Minggu sebelumnya"
        className="inline-flex size-10 items-center justify-center rounded-lg text-neutral-700 active:bg-neutral-100"
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="flex flex-1 flex-col items-center">
        <p className="text-sm font-semibold text-neutral-900">
          {startLabel} – {endLabel} {yearLabel}
        </p>
        <button
          type="button"
          onClick={onToday}
          className={cn(
            "mt-0.5 text-[11px] uppercase tracking-[0.16em]",
            isCurrentWeek
              ? "text-mahakan-green-700"
              : "text-neutral-500 underline-offset-2 hover:underline",
          )}
        >
          {isCurrentWeek ? "Minggu ini" : "Ke minggu ini"}
        </button>
      </div>
      <button
        type="button"
        onClick={onNext}
        aria-label="Minggu berikutnya"
        className="inline-flex size-10 items-center justify-center rounded-lg text-neutral-700 active:bg-neutral-100"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}

function DayList({
  days,
  todayKey,
  entriesByDate,
}: {
  days: Array<{ key: string; date: Date; dow: number; dayNum: number }>;
  todayKey: string;
  entriesByDate: Map<string, EmployeeSchedule>;
}) {
  const hasAny = Array.from(entriesByDate.values()).length > 0;

  return (
    <div className="space-y-2">
      {!hasAny ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center">
          <CalendarDays className="mx-auto size-6 text-neutral-400" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-neutral-800">
            Belum ada jadwal
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Owner / HR belum set jadwal kamu untuk minggu ini.
          </p>
        </div>
      ) : null}

      {days.map((d) => {
        const entry = entriesByDate.get(d.key);
        const isToday = d.key === todayKey;
        return (
          <DayRow
            key={d.key}
            dayNum={d.dayNum}
            dowLong={DAY_LABELS_LONG[d.dow]}
            dowShort={DAY_LABELS_SHORT[d.dow]}
            month={MONTH_LABELS[d.date.getUTCMonth()]}
            entry={entry ?? null}
            isToday={isToday}
          />
        );
      })}
    </div>
  );
}

function DayRow({
  dayNum,
  dowLong,
  dowShort,
  month,
  entry,
  isToday,
}: {
  dayNum: number;
  dowLong: string;
  dowShort: string;
  month: string;
  entry: EmployeeSchedule | null;
  isToday: boolean;
}) {
  const status: "off" | "work" | "unset" = entry?.dayOff
    ? "off"
    : entry
      ? "work"
      : "unset";

  return (
    <article
      className={cn(
        "flex items-stretch gap-3 rounded-xl border bg-white p-3 shadow-sm",
        isToday
          ? "border-mahakan-green-700 ring-2 ring-mahakan-green-100"
          : "border-neutral-200",
      )}
    >
      <div
        className={cn(
          "flex w-14 shrink-0 flex-col items-center justify-center rounded-lg px-1 py-2",
          isToday
            ? "bg-mahakan-green-700 text-white"
            : "bg-neutral-50 text-neutral-700",
        )}
      >
        <span className="text-[10px] uppercase tracking-[0.12em] opacity-90">
          {dowShort}
        </span>
        <span className="text-xl font-bold leading-tight">{dayNum}</span>
        <span className="text-[10px] opacity-75">{month}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">
          {dowLong}
          {isToday ? (
            <span className="ml-2 rounded bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-mahakan-green-800">
              Hari ini
            </span>
          ) : null}
        </p>
        {status === "work" ? (
          <div className="mt-1 flex items-center gap-2 text-base font-semibold text-neutral-900">
            <Clock className="size-4 text-mahakan-green-700" aria-hidden />
            <span className="font-mono">
              {fmtTime(entry!.startTime)} – {fmtTime(entry!.endTime)}
            </span>
          </div>
        ) : status === "off" ? (
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-neutral-700">
            <Coffee className="size-4 text-warning-500" aria-hidden />
            <span>Libur (OFF)</span>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
            <CircleSlash className="size-4" aria-hidden />
            <span>Belum di-set</span>
          </div>
        )}
        {entry?.notes ? (
          <p className="mt-1 line-clamp-2 text-xs text-neutral-600">
            {entry.notes}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function ErrorPanel({
  code,
  message,
}: {
  code: string | null;
  message: string;
}) {
  const isLink = code === "NOT_LINKED";
  return (
    <div className="rounded-xl border border-warning-100 bg-warning-50 p-4 text-center">
      <p className="text-sm font-semibold text-warning-700">
        {isLink ? "Akun belum di-link" : "Tidak bisa memuat jadwal"}
      </p>
      <p className="mt-1 text-xs text-warning-700/90">{message}</p>
    </div>
  );
}

// ---------- date utils (WIB-aware) ----------

/** Convert a Date to YYYY-MM-DD in Asia/Jakarta. */
function isoDateInWib(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/** Returns ISO date of the Monday-of-week containing `now` (WIB). */
function weekStartFor(now: Date): string {
  const wibIso = isoDateInWib(now);
  // Use UTC-anchored date math to avoid host-tz drift.
  const anchor = new Date(`${wibIso}T00:00:00Z`);
  const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  anchor.setUTCDate(anchor.getUTCDate() + offsetToMon);
  return anchor.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildWeekDays(
  weekStart: string,
): Array<{ key: string; date: Date; dow: number; dayNum: number }> {
  const out: Array<{ key: string; date: Date; dow: number; dayNum: number }> =
    [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    out.push({
      key: d.toISOString().slice(0, 10),
      date: d,
      dow: d.getUTCDay(),
      dayNum: d.getUTCDate(),
    });
  }
  return out;
}

function fmtTime(t: string | null): string {
  if (!t) return "—";
  // DB stores HH:MM:SS or HH:MM. Strip seconds.
  return t.slice(0, 5);
}
