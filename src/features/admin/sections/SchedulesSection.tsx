"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  Skeleton,
  TimePicker,
  toast,
} from "@/components/ui";
import {
  bulkAssignSchedule,
  copyWeekSchedules,
  deleteSchedule,
  isOk,
  listActiveEmployees,
  listSchedules,
  upsertSchedule,
  type ScheduleWithEmployee,
} from "@/features/schedules";
import {
  bulkBackfillAttendance,
  createManualAttendance,
  deleteManualAttendance,
  editAttendanceManual,
} from "@/features/attendance/actions";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getAttendanceCalendar,
  isOk as hrIsOk,
  type AttendanceCalendar,
  type AttendanceCalendarCell,
  type AttendanceDayStatus,
} from "@/features/hr-reports";
import {
  getOwnOutlet,
  isOk as isOutletOk,
  updateScheduleTemplates,
} from "@/features/outlets";
import { toJakartaDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

const DAYS_OF_WEEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/* Sesi AE-51/53 — template shift untuk percepat input HR. Defaults
 * jadi fallback kalau outlet belum custom templates di Settings.
 * AE-53: defaults disesuaikan dengan jam operasional Mahakan owner ask. */
export const DEFAULT_SHIFT_TEMPLATES: ReadonlyArray<{
  label: string;
  start: string;
  end: string;
}> = [
  /* Sesi AE-62ae — defaults disesuaikan ops Mahakan owner directive 2026-05-18.
   *   - Weekday: buka 14:00-22:00, staff masuk 13:00 (prep 1 jam).
   *   - Weekend: buka 09:00-23:00 dengan 3 shift (Pagi/Siang/Full=double).
   * Owner edit lewat Settings → Template Shift kalau outlet beda jam ops. */
  { label: "Weekday", start: "13:00", end: "22:00" },
  { label: "Pagi", start: "08:00", end: "17:00" },
  { label: "Siang", start: "13:00", end: "23:00" },
  { label: "Full / Double", start: "08:00", end: "23:00" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns Monday of the ISO week containing `d`. */
function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  const dow = out.getUTCDay(); // 0 = Sunday
  const offset = dow === 0 ? -6 : 1 - dow;
  out.setUTCDate(out.getUTCDate() + offset);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

interface ActiveEmployee {
  id: string;
  fullName: string;
  nickname: string | null;
  position: string | null;
}

type ViewMode = "schedule" | "attendance";
type RangeMode = "week" | "month";

/** Sesi AE-23 — status → cell style. Konsisten dengan HR Calendar
 *  (HrReportsSection). Owner request: tabel Jadwal-style dengan cells
 *  berisi historis absen (Hadir/Telat/Off/Alpa).
 *
 *  Sesi AE-61 — tambah status `upcoming` (jadwal masa depan, belum bisa
 *  dianggap alpa). Cell visual: outlined dashed indigo supaya jelas
 *  "menunggu" tapi tidak alarming seperti merah alpa.
 */
const ATTENDANCE_STYLE: Record<
  AttendanceDayStatus,
  { label: string; cellClass: string; legend: string; description: string }
> = {
  hadir: {
    label: "H",
    cellClass: "border-success-500/40 bg-success-100/60 text-success-700",
    legend: "Hadir",
    description: "Karyawan sudah clock-in tepat waktu",
  },
  telat: {
    label: "T",
    cellClass: "border-warning-500/40 bg-warning-100/60 text-warning-700",
    legend: "Telat",
    description: "Clock-in lewat jam shift mulai",
  },
  off: {
    label: "Off",
    cellClass: "border-neutral-200 bg-neutral-100 text-neutral-600",
    legend: "Libur",
    description: "Hari libur (di-set OFF di jadwal)",
  },
  alpa: {
    label: "A",
    cellClass: "border-danger-500/40 bg-danger-100/60 text-danger-700",
    legend: "Alpa",
    description: "Ada jadwal kerja tapi tidak ada clock-in",
  },
  upcoming: {
    label: "·",
    cellClass:
      "border-dashed border-mahakan-green-300 bg-mahakan-green-50/40 text-mahakan-green-700",
    legend: "Belum Tiba",
    description: "Jadwal kerja, tanggalnya masih di masa depan",
  },
  kosong: {
    label: "—",
    cellClass: "border-neutral-200 bg-white text-neutral-400",
    legend: "Tanpa Jadwal",
    description: "Tidak ada jadwal yang ter-assign",
  },
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function SchedulesSection() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeekMonday(new Date()),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("schedule");
  const [rangeMode, setRangeMode] = useState<RangeMode>("week");
  const [attendanceDetail, setAttendanceDetail] = useState<{
    employeeId: string;
    employeeName: string;
    date: string;
    cell: AttendanceCalendarCell;
  } | null>(null);
  /* Sesi AE-162 — modal backfill massal absen. */
  const [bulkBackfillOpen, setBulkBackfillOpen] = useState(false);
  const queryClient = useQueryClient();
  const { session } = useSession();
  const canManualEdit =
    !!session && hasPermission(session.user.role, "attendance.manual_edit");

  const [editing, setEditing] = useState<{
    employee: ActiveEmployee;
    date: string;
    existing: ScheduleWithEmployee | null;
  } | null>(null);

  // Sesi AE-53 — bulk assign + edit templates modals.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Sesi AE-23 — week count: 1 untuk weekly, 5 untuk monthly stack.
  const weekCount = rangeMode === "month" ? 5 : 1;
  const allWeekDates = useMemo(() => {
    return Array.from({ length: weekCount }, (_, weekIdx) =>
      Array.from({ length: 7 }, (_, dayIdx) =>
        addDays(weekStart, weekIdx * 7 + dayIdx),
      ),
    );
  }, [weekStart, weekCount]);

  const fromIso = isoDate(allWeekDates[0]![0]!);
  const toIso = isoDate(allWeekDates[weekCount - 1]![6]!);

  // Sesi AE-14 — TanStack Query. Active employees jarang ganti (5min cache);
  // schedules per-week cached.
  const employeesQuery = useQuery({
    queryKey: ["admin", "employees", "active"],
    queryFn: async () => {
      const res = await listActiveEmployees();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  // Sesi AE-53 — outlet settings untuk schedule templates (editable per
  // outlet, fallback DEFAULT_SHIFT_TEMPLATES kalau belum di-set).
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!isOutletOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const shiftTemplates = useMemo<
    ReadonlyArray<{ label: string; start: string; end: string }>
  >(() => {
    const fromSettings =
      outletQuery.data?.settings?.scheduleTemplates ?? null;
    return fromSettings && fromSettings.length > 0
      ? fromSettings
      : DEFAULT_SHIFT_TEMPLATES;
  }, [outletQuery.data]);
  const schedulesQuery = useQuery({
    queryKey: ["admin", "schedules", "list", fromIso, toIso],
    queryFn: async () => {
      const res = await listSchedules({ from: fromIso, to: toIso });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: viewMode === "schedule",
  });
  // Sesi AE-23 — attendance calendar query, hanya jalan di view "attendance".
  const attendanceQuery = useQuery({
    queryKey: ["admin", "attendance-calendar", fromIso, toIso],
    queryFn: async () => {
      const res = await getAttendanceCalendar({ from: fromIso, to: toIso });
      if (!hrIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: viewMode === "attendance",
  });
  const attendance: AttendanceCalendar | null = attendanceQuery.data ?? null;
  const employees = useMemo(
    () => employeesQuery.data ?? [],
    [employeesQuery.data],
  );
  const schedules = useMemo(
    () => schedulesQuery.data ?? [],
    [schedulesQuery.data],
  );
  const loading =
    employeesQuery.isLoading ||
    (viewMode === "schedule" && schedulesQuery.isLoading) ||
    (viewMode === "attendance" && attendanceQuery.isLoading);

  const attendanceByKey = useMemo(() => {
    const m = new Map<string, AttendanceCalendarCell>();
    if (!attendance) return m;
    for (const row of attendance.rows) {
      for (const [date, cell] of Object.entries(row.days)) {
        m.set(`${row.employeeId}::${date}`, cell);
      }
    }
    return m;
  }, [attendance]);

  // Sesi AE-61 — today WIB untuk highlight kolom + boundary upcoming.
  const todayIso = useMemo(() => toJakartaDateOnly(new Date()), []);

  // Sesi AE-61 — stats summary untuk attendance view (4 metric cards
  // di atas tabel). Compute sekali per attendance load.
  const attendanceStats = useMemo(() => {
    const empty = {
      hadir: 0,
      telat: 0,
      alpa: 0,
      off: 0,
      upcoming: 0,
      totalScheduledPast: 0,
      totalLateMinutes: 0,
      totalWorkMinutes: 0,
      totalOvertimeMinutes: 0,
    };
    if (!attendance) return empty;
    const s = { ...empty };
    for (const row of attendance.rows) {
      for (const cell of Object.values(row.days)) {
        if (cell.status === "hadir") s.hadir++;
        else if (cell.status === "telat") s.telat++;
        else if (cell.status === "alpa") s.alpa++;
        else if (cell.status === "off") s.off++;
        else if (cell.status === "upcoming") s.upcoming++;
        if (
          cell.status === "hadir" ||
          cell.status === "telat" ||
          cell.status === "alpa"
        ) {
          s.totalScheduledPast++;
        }
        s.totalLateMinutes += cell.lateMinutes ?? 0;
        s.totalWorkMinutes += cell.workMinutes ?? 0;
        s.totalOvertimeMinutes += cell.overtimeMinutes ?? 0;
      }
    }
    return s;
  }, [attendance]);
  const attendanceRate = attendanceStats.totalScheduledPast > 0
    ? Math.round(
        ((attendanceStats.hadir + attendanceStats.telat) /
          attendanceStats.totalScheduledPast) *
          100,
      )
    : null;

  function refresh() {
    /* Sesi AE-51 — bug fix: dulu cuma invalidate "schedules" → Edit Jadwal
     * tab update tapi Historis Absen tab tetap stale (pakai cache lama
     * dengan dayOff=false). Akibat: jadwal di-set OFF tapi Historis Absen
     * tampil ALPHA. Sekarang invalidate kedua query supaya konsisten. */
    void queryClient.invalidateQueries({ queryKey: ["admin", "schedules"] });
    void queryClient.invalidateQueries({
      queryKey: ["admin", "attendance-calendar"],
    });
  }

  // Index schedules by (employeeId, scheduleDate) for O(1) cell lookup.
  const scheduleMap = useMemo(() => {
    const m = new Map<string, ScheduleWithEmployee>();
    for (const s of schedules) {
      m.set(`${s.employeeId}::${s.scheduleDate}`, s);
    }
    return m;
  }, [schedules]);

  function navigateWeek(deltaDays: number) {
    setWeekStart((prev) => addDays(prev, deltaDays));
  }

  async function handleCopyLastWeek() {
    if (
      !confirm(
        "Salin jadwal minggu lalu ke minggu ini? Tanggal yang sudah punya jadwal di minggu ini akan dilewati.",
      )
    )
      return;
    const lastWeekStart = isoDate(addDays(weekStart, -7));
    const res = await copyWeekSchedules({
      fromStart: lastWeekStart,
      toStart: fromIso,
    });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `${res.data.copied} jadwal disalin, ${res.data.skipped} dilewati`,
    );
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <CalendarDays className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Jadwal
            </h1>
            <p className="text-sm text-neutral-600">
              {viewMode === "schedule"
                ? "Mingguan per karyawan. Tap cell untuk set jam atau tandai libur."
                : "Historis absen per karyawan. Tap cell untuk lihat detail clock-in / out."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "schedule" ? (
            <>
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <Layers className="size-4" aria-hidden /> Bulk Assign
              </Button>
              <Button
                variant="outline"
                onClick={() => setTemplatesOpen(true)}
                title="Edit template jam shift (Pagi/Siang/Sore/Full)"
              >
                <Pencil className="size-4" aria-hidden /> Template
              </Button>
              <Button variant="outline" onClick={handleCopyLastWeek}>
                <Copy className="size-4" aria-hidden /> Salin Minggu Lalu
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            onClick={() => navigateWeek(rangeMode === "month" ? -35 : -7)}
            title={rangeMode === "month" ? "Mundur 5 minggu" : "Mundur 1 minggu"}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <div className="rounded-md bg-white border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900">
            {allWeekDates[0]![0]!.toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
            })}{" "}
            —{" "}
            {allWeekDates[weekCount - 1]![6]!.toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <Button
            variant="outline"
            onClick={() => navigateWeek(rangeMode === "month" ? 35 : 7)}
            title={rangeMode === "month" ? "Maju 5 minggu" : "Maju 1 minggu"}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      {/* Sesi AE-23 — view mode + range toggles. Owner request: tabel
       * historis absen 1 bulan dengan layout Jadwal-style. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("schedule")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              viewMode === "schedule"
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-700 hover:bg-neutral-100",
            )}
          >
            <Pencil className="size-3.5" /> Edit Jadwal
          </button>
          <button
            type="button"
            onClick={() => setViewMode("attendance")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              viewMode === "attendance"
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-700 hover:bg-neutral-100",
            )}
          >
            <Clock className="size-3.5" /> Historis Absen
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setRangeMode("week")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              rangeMode === "week"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            1 Minggu
          </button>
          <button
            type="button"
            onClick={() => setRangeMode("month")}
            className={cn(
              "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              rangeMode === "month"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            <CalendarRange className="size-3" /> 5 Minggu
          </button>
        </div>
        {viewMode === "attendance" && canManualEdit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkBackfillOpen(true)}
          >
            <CalendarCheck className="size-4" aria-hidden /> Backfill Hadir
          </Button>
        ) : null}
        {viewMode === "attendance" ? (
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {(
              ["hadir", "telat", "alpa", "upcoming", "off", "kosong"] as const
            ).map((s) => {
              const meta = ATTENDANCE_STYLE[s];
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 text-neutral-700"
                  title={meta.description}
                >
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded border text-[10px] font-bold",
                      meta.cellClass,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="font-medium">{meta.legend}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Sesi AE-61 — stats summary cards. Tampil di Historis Absen view
        * supaya HR langsung lihat metrik penting tanpa hitung manual cell. */}
      {viewMode === "attendance" && !loading && attendance ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Tingkat Kehadiran"
            value={
              attendanceRate !== null ? `${attendanceRate}%` : "—"
            }
            tone={
              attendanceRate === null
                ? "neutral"
                : attendanceRate >= 90
                  ? "success"
                  : attendanceRate >= 75
                    ? "warning"
                    : "danger"
            }
            hint={
              attendanceStats.totalScheduledPast > 0
                ? `${attendanceStats.hadir + attendanceStats.telat} hadir dari ${attendanceStats.totalScheduledPast} jadwal kerja (sampai hari ini)`
                : "Belum ada jadwal kerja yang lewat di range ini"
            }
          />
          <StatCard
            label="Telat"
            value={String(attendanceStats.telat)}
            tone={attendanceStats.telat > 0 ? "warning" : "neutral"}
            hint={
              attendanceStats.totalLateMinutes > 0
                ? `Total ${formatDuration(attendanceStats.totalLateMinutes)} keterlambatan`
                : "Belum ada keterlambatan"
            }
          />
          <StatCard
            label="Alpa"
            value={String(attendanceStats.alpa)}
            tone={attendanceStats.alpa > 0 ? "danger" : "neutral"}
            hint={
              attendanceStats.alpa > 0
                ? "Jadwal kerja tanpa clock-in di tanggal yang sudah lewat"
                : "Tidak ada alpa di range ini"
            }
          />
          <StatCard
            label="Akan Datang"
            value={String(attendanceStats.upcoming)}
            tone="info"
            hint={
              attendanceStats.upcoming > 0
                ? "Jadwal kerja di tanggal masa depan (belum bisa dinilai)"
                : "Tidak ada jadwal di masa depan dalam range ini"
            }
          />
        </div>
      ) : null}

      <Card>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CalendarDays
                className="size-8 text-neutral-300"
                aria-hidden
              />
              <p className="text-sm font-medium text-neutral-700">
                Belum ada karyawan aktif
              </p>
              <p className="text-xs text-neutral-500">
                Tambah karyawan dulu di tab Karyawan.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {allWeekDates.map((wkDates, wkIdx) => (
                <div key={wkIdx} className="overflow-x-auto rounded-lg border border-neutral-200">
                  <table className="w-full text-sm">
                    {rangeMode === "month" ? (
                      <caption className="caption-top bg-mahakan-green-50/40 px-4 py-1.5 text-left text-xs font-semibold text-mahakan-green-900">
                        Minggu {wkIdx + 1} ·{" "}
                        {wkDates[0]!.toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        —{" "}
                        {wkDates[6]!.toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}
                      </caption>
                    ) : null}
                    <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-2">
                          Karyawan
                        </th>
                        {wkDates.map((d, i) => {
                          const dIso = isoDate(d);
                          const isToday = dIso === todayIso;
                          return (
                            <th
                              key={i}
                              className={cn(
                                "px-3 py-2 text-center",
                                isToday &&
                                  "bg-mahakan-green-100/60 text-mahakan-green-900",
                              )}
                            >
                              <div className="flex items-center justify-center gap-1">
                                {DAYS_OF_WEEK[i]}
                                {isToday ? (
                                  <span className="inline-flex rounded-full bg-mahakan-green-700 px-1.5 py-0 text-[8px] font-bold uppercase tracking-wide text-white">
                                    Hari Ini
                                  </span>
                                ) : null}
                              </div>
                              <div className="font-mono text-[10px] text-neutral-400">
                                {d.toLocaleDateString("id-ID", {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => (
                        <tr
                          key={emp.id}
                          className="border-b border-neutral-100 last:border-0"
                        >
                          <td className="sticky left-0 z-10 bg-white px-4 py-3">
                            <div className="font-medium text-neutral-900">
                              {emp.fullName}
                            </div>
                            {emp.position ? (
                              <div className="text-xs text-neutral-500">
                                {emp.position}
                              </div>
                            ) : null}
                          </td>
                          {wkDates.map((d) => {
                            const dateIso = isoDate(d);
                            const isToday = dateIso === todayIso;
                            const existing =
                              scheduleMap.get(`${emp.id}::${dateIso}`) ?? null;
                            const cell =
                              attendanceByKey.get(`${emp.id}::${dateIso}`) ??
                              null;
                            return (
                              <td
                                key={dateIso}
                                className={cn(
                                  "px-2 py-2 text-center align-middle",
                                  isToday && "bg-mahakan-green-50/30",
                                )}
                              >
                                {viewMode === "schedule" ? (
                                  <ScheduleCell
                                    schedule={existing}
                                    onClick={() =>
                                      setEditing({
                                        employee: emp,
                                        date: dateIso,
                                        existing,
                                      })
                                    }
                                  />
                                ) : (
                                  <AttendanceCell
                                    cell={cell}
                                    isToday={isToday}
                                    onClick={() => {
                                      if (!cell) return;
                                      if (
                                        cell.status === "upcoming" ||
                                        cell.status === "kosong"
                                      )
                                        return;
                                      setAttendanceDetail({
                                        employeeId: emp.id,
                                        employeeName: emp.fullName,
                                        date: dateIso,
                                        cell,
                                      });
                                    }}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleEditDialog
        editing={editing}
        templates={shiftTemplates}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      {bulkOpen ? (
        <BulkAssignDialog
          employees={employees}
          templates={shiftTemplates}
          weekStart={weekStart}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            refresh();
          }}
        />
      ) : null}

      {templatesOpen ? (
        <EditTemplatesDialog
          current={shiftTemplates}
          onClose={() => setTemplatesOpen(false)}
          onSaved={() => {
            setTemplatesOpen(false);
            void queryClient.invalidateQueries({
              queryKey: ["admin", "outlet"],
            });
          }}
        />
      ) : null}

      <AttendanceDetailModal
        detail={attendanceDetail}
        onClose={() => setAttendanceDetail(null)}
        onSaved={() => {
          /* Sesi AE-63 phase8 — refresh calendar setelah HR manual edit
           * attendance. Modal close-nya tetap manual oleh user supaya
           * bisa lihat updated state sebelum tutup. */
          void queryClient.invalidateQueries({
            queryKey: ["admin", "attendance-calendar"],
          });
        }}
      />

      {bulkBackfillOpen ? (
        <BulkBackfillModal
          employees={employees}
          defaultFrom={fromIso}
          defaultTo={toIso}
          onClose={() => setBulkBackfillOpen(false)}
          onDone={() => {
            setBulkBackfillOpen(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AttendanceCell({
  cell,
  onClick,
  isToday,
}: {
  cell: AttendanceCalendarCell | null;
  onClick: () => void;
  isToday?: boolean;
}) {
  if (!cell) {
    return (
      <span
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-xs text-neutral-400",
          isToday && "ring-2 ring-mahakan-green-500/40 ring-offset-1",
        )}
      >
        —
      </span>
    );
  }
  const meta = ATTENDANCE_STYLE[cell.status];
  const lateBadge =
    (cell.status === "telat" || cell.status === "hadir") &&
    cell.lateMinutes &&
    cell.lateMinutes > 0
      ? formatDuration(cell.lateMinutes)
      : null;
  // Sesi AE-61 — upcoming/kosong non-clickable (tidak ada detail to show).
  const clickable = cell.status !== "upcoming" && cell.status !== "kosong";
  const Component = clickable ? "button" : "div";
  return (
    <Component
      {...(clickable ? { type: "button" as const, onClick } : {})}
      className={cn(
        "inline-flex w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1.5 text-xs font-bold transition-colors",
        meta.cellClass,
        clickable && "cursor-pointer hover:brightness-95",
        !clickable && "cursor-default",
        isToday && "ring-2 ring-mahakan-green-500/60 ring-offset-1",
      )}
      title={`${meta.legend} — ${meta.description}`}
    >
      <span className="text-sm">{meta.label}</span>
      {lateBadge ? (
        <span className="text-[9px] font-mono opacity-80">+{lateBadge}</span>
      ) : null}
    </Component>
  );
}

function AttendanceDetailModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: {
    employeeId: string;
    employeeName: string;
    date: string;
    cell: AttendanceCalendarCell;
  } | null;
  onClose: () => void;
  /* Sesi AE-63 phase8 — callback dari HR manual edit attendance. */
  onSaved?: () => void;
}) {
  /* Sesi AE-63 phase8 — HR Bayu request: edit status + late/OT manual. */
  const { session } = useSession();
  const canEdit =
    !!session && hasPermission(session.user.role, "attendance.manual_edit");
  /* Sesi AE-162 — formMode: "edit" untuk record yang ada, "create" untuk
   * input absen manual di hari Alpa (tanpa clock-in). */
  const [formMode, setFormMode] = useState<null | "edit" | "create">(null);
  const [editIsLate, setEditIsLate] = useState<"yes" | "no" | "unknown">(
    "unknown",
  );
  const [editLate, setEditLate] = useState("");
  const [editOT, setEditOT] = useState("");
  const [editReason, setEditReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /* Sesi AE-162 — konfirmasi hapus entri manual. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* Reset edit state when detail changes. */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setFormMode(null);
    setConfirmDelete(false);
    if (detail) {
      setEditIsLate(
        (detail.cell.isLate ?? "unknown") as "yes" | "no" | "unknown",
      );
      setEditLate(String(detail.cell.lateMinutes ?? 0));
      setEditOT(String(detail.cell.overtimeMinutes ?? 0));
      setEditReason("");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [detail?.cell.recordId, detail?.date]);

  if (!detail) return null;
  const meta = ATTENDANCE_STYLE[detail.cell.status];
  const dateLabel = new Date(`${detail.date}T00:00:00Z`).toLocaleDateString(
    "id-ID",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );
  /* Sesi AE-50 — HR request: tampil info lengkap (clock-in/out time, GPS,
   * selfie preview + Drive links) bukan cuma badge status. */
  const clockInTime = detail.cell.clockInAt
    ? formatClockTime(detail.cell.clockInAt)
    : null;
  const clockOutTime = detail.cell.clockOutAt
    ? formatClockTime(detail.cell.clockOutAt)
    : null;

  /* Sesi AE-63 phase8 — edit only available kalau ada attendance record
   * (status hadir/telat). Off/alpa/kosong tidak ada record untuk di-edit. */
  const hasRecord = !!detail.cell.recordId;
  /* Sesi AE-162 — input manual untuk hari Alpa (terjadwal, lewat, tanpa
   * clock-in). Hapus hanya untuk record yang dibuat manual oleh HR. */
  const isManualEntry = !!detail.cell.isManualEntry;
  const canCreate = canEdit && !hasRecord && detail.cell.status === "alpa";
  const canDeleteManual = canEdit && hasRecord && isManualEntry;
  const schedStart = detail.cell.scheduleStartTime
    ? formatHm(detail.cell.scheduleStartTime)
    : null;
  const schedEnd = detail.cell.scheduleEndTime
    ? formatHm(detail.cell.scheduleEndTime)
    : null;

  async function onSubmitEdit() {
    if (!detail?.cell.recordId || submitting) return;
    const lateN = parseInt(editLate, 10);
    const otN = parseInt(editOT, 10);
    if (!Number.isFinite(lateN) || lateN < 0) {
      toast.error("Telat minutes harus angka non-negatif");
      return;
    }
    if (!Number.isFinite(otN) || otN < 0) {
      toast.error("Overtime minutes harus angka non-negatif");
      return;
    }
    if (editReason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setSubmitting(true);
    const res = await editAttendanceManual({
      recordId: detail.cell.recordId,
      isLate: editIsLate,
      lateMinutes: lateN,
      overtimeMinutes: otN,
      reason: editReason.trim(),
    });
    setSubmitting(false);
    if (res.success) {
      toast.success("Status absen ter-update");
      setFormMode(null);
      onSaved?.();
    } else {
      toast.error(res.error.message);
    }
  }

  /* Sesi AE-162 — buat record absen manual (Tandai Hadir) untuk hari Alpa. */
  async function onSubmitCreate() {
    if (!detail || submitting) return;
    const lateN = editIsLate === "yes" ? parseInt(editLate, 10) || 0 : 0;
    const otN = parseInt(editOT, 10) || 0;
    if (editReason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter (mis. 'rekap absen manual Mei')");
      return;
    }
    setSubmitting(true);
    const res = await createManualAttendance({
      employeeId: detail.employeeId,
      shiftDate: detail.date,
      isLate: editIsLate,
      lateMinutes: lateN,
      overtimeMinutes: otN,
      reason: editReason.trim(),
    });
    setSubmitting(false);
    if (res.success) {
      toast.success("Absen ditandai Hadir (manual)");
      setFormMode(null);
      onSaved?.();
      onClose();
    } else {
      toast.error(res.error.message);
    }
  }

  /* Sesi AE-162 — hapus entri manual → kembali ke Alpa. */
  async function onDelete() {
    if (!detail?.cell.recordId || deleting) return;
    setDeleting(true);
    const res = await deleteManualAttendance({
      recordId: detail.cell.recordId,
      reason: editReason.trim() || null,
    });
    setDeleting(false);
    if (res.success) {
      toast.success("Entri manual dihapus — kembali ke Alpa");
      setConfirmDelete(false);
      onSaved?.();
      onClose();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Detail Absen — ${detail.employeeName}`}
      description={dateLabel}
      size="2xl"
      footer={
        formMode === "edit" ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setFormMode(null)}
              disabled={submitting}
            >
              Batal Edit
            </Button>
            <Button onClick={onSubmitEdit} loading={submitting}>
              Simpan
            </Button>
          </>
        ) : formMode === "create" ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setFormMode(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={onSubmitCreate} loading={submitting}>
              <CheckCircle2 className="size-4" aria-hidden /> Tandai Hadir
            </Button>
          </>
        ) : (
          <>
            {canDeleteManual ? (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="text-danger-500 hover:bg-danger-100/50"
              >
                <Trash2 className="size-4" aria-hidden /> Hapus Entri
              </Button>
            ) : null}
            {canEdit && hasRecord ? (
              <Button variant="outline" onClick={() => setFormMode("edit")}>
                <Pencil className="size-4" aria-hidden /> Edit Status
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Tutup
            </Button>
            {canCreate ? (
              <Button onClick={() => setFormMode("create")}>
                <CheckCircle2 className="size-4" aria-hidden /> Tandai Hadir
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <div
          className={cn(
            "rounded-lg border p-3 text-center",
            meta.cellClass,
          )}
        >
          <div className="text-xs uppercase tracking-wider opacity-80">
            Status
          </div>
          <div className="mt-0.5 text-base font-bold">{meta.legend}</div>
        </div>

        {/* Sesi AE-63 phase8 / AE-162 — badge provenance: bedakan record
          * yang DI-INPUT manual (backfill / koreksi) vs clock-in asli yang
          * di-edit statusnya. HR perlu tahu mana data mock vs data real. */}
        {formMode === null && detail.cell.manualEditAt ? (
          <div className="rounded-md border border-mahakan-green-700/30 bg-mahakan-green-50/40 p-2.5 text-xs">
            <div className="font-semibold text-mahakan-green-900">
              {isManualEntry
                ? "🖊 Absen di-input manual oleh HR (bukan clock-in asli)"
                : "✎ Status sudah di-edit manual oleh HR"}
            </div>
            {detail.cell.manualEditReason ? (
              <div className="mt-0.5 text-neutral-700">
                Alasan: <em>{detail.cell.manualEditReason}</em>
              </div>
            ) : null}
            <div className="mt-0.5 text-[10px] text-neutral-500">
              {new Date(detail.cell.manualEditAt).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </div>
          </div>
        ) : null}

        {/* Sesi AE-162 — form input absen manual (Tandai Hadir) untuk hari
          * Alpa. Jam ikut shift terjadwal; HR set telat/lembur opsional. */}
        {formMode === "create" ? (
          <div className="space-y-3 rounded-lg border border-mahakan-green-700/40 bg-mahakan-green-50/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
              Input Absen Manual — Tandai Hadir
            </div>
            <div className="rounded-md border border-mahakan-green-700/20 bg-white p-3 text-xs text-neutral-700">
              {schedStart && schedEnd ? (
                <>
                  Jam kerja akan dicatat sesuai shift terjadwal:{" "}
                  <span className="font-mono font-semibold text-neutral-900">
                    {schedStart}–{schedEnd}
                  </span>
                  . Cocok untuk rekap absen lama / staff lupa clock-in.
                </>
              ) : (
                <>Hari ini akan ditandai Hadir tanpa detail jam.</>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Status Telat
              </label>
              <div className="flex gap-1.5">
                {(
                  [
                    { v: "no", label: "Tidak Telat" },
                    { v: "yes", label: "Telat" },
                    { v: "unknown", label: "Tidak diketahui" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setEditIsLate(opt.v)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                      editIsLate === opt.v
                        ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Telat (menit)"
                type="text"
                inputMode="numeric"
                value={editIsLate === "yes" ? editLate : "0"}
                disabled={editIsLate !== "yes"}
                onChange={(e) => setEditLate(e.target.value)}
              />
              <Input
                label="Overtime (menit)"
                type="text"
                inputMode="numeric"
                value={editOT}
                onChange={(e) => setEditOT(e.target.value)}
              />
            </div>
            <Input
              label="Alasan (wajib, min 3 karakter)"
              placeholder="mis. rekap absen manual Mei, staff lupa clock-in"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              maxLength={500}
            />
            <p className="text-[10px] text-neutral-500">
              Entri ini ditandai &ldquo;input manual&rdquo; (tanpa selfie/GPS),
              ter-audit dengan nama kamu + alasan, dan akan dihitung saat
              payroll di-Recompute.
            </p>
          </div>
        ) : null}

        {/* Sesi AE-63 phase8 — inline edit form (HR manual override).
          * Force-set isLate/lateMinutes/overtimeMinutes + reason. */}
        {formMode === "edit" ? (
          <div className="space-y-2 rounded-md border border-mahakan-green-700/40 bg-mahakan-green-50/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
              Edit Status Manual
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Status Telat
              </label>
              <div className="flex gap-1.5">
                {(
                  [
                    { v: "no", label: "Tidak Telat" },
                    { v: "yes", label: "Telat" },
                    { v: "unknown", label: "Tidak diketahui" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setEditIsLate(opt.v)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                      editIsLate === opt.v
                        ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Telat (menit)"
                type="text"
                inputMode="numeric"
                value={editLate}
                onChange={(e) => setEditLate(e.target.value)}
              />
              <Input
                label="Overtime (menit)"
                type="text"
                inputMode="numeric"
                value={editOT}
                onChange={(e) => setEditOT(e.target.value)}
              />
            </div>
            <Input
              label="Alasan (wajib, min 3 karakter)"
              placeholder="mis. konfirmasi izin via WA, sakit, lupa absen"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              maxLength={500}
            />
            <p className="text-[10px] text-neutral-500">
              Override ini akan ter-audit ke audit log dengan nama kamu +
              waktu + alasan. Payroll akan re-compute pakai nilai baru ini.
            </p>
          </div>
        ) : null}

        {/* Sesi AE-50 — Clock In/Out times */}
        {(clockInTime || clockOutTime) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Clock In
              </div>
              <div className="mt-0.5 font-mono text-base font-semibold text-neutral-900">
                {clockInTime ?? "—"}
              </div>
            </div>
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Clock Out
              </div>
              <div className="mt-0.5 font-mono text-base font-semibold text-neutral-900">
                {clockOutTime ?? (
                  <span className="text-neutral-500">belum</span>
                )}
              </div>
            </div>
          </div>
        )}

        {detail.cell.workMinutes !== undefined &&
        detail.cell.workMinutes > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3">
            <span className="text-neutral-700">Total Kerja</span>
            <span className="font-mono font-semibold text-neutral-900">
              {formatDuration(detail.cell.workMinutes)}
            </span>
          </div>
        ) : null}
        {detail.cell.lateMinutes !== undefined &&
        detail.cell.lateMinutes > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-warning-300 bg-warning-100/40 p-3">
            <span className="text-warning-500">Telat</span>
            <span className="font-mono font-semibold text-warning-500">
              {formatDuration(detail.cell.lateMinutes)}
            </span>
          </div>
        ) : null}
        {detail.cell.overtimeMinutes !== undefined &&
        detail.cell.overtimeMinutes > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-success-500/40 bg-success-100/40 p-3">
            <span className="text-success-500">Overtime</span>
            <span className="font-mono font-semibold text-success-500">
              {formatDuration(detail.cell.overtimeMinutes)}
            </span>
          </div>
        ) : null}

        {/* Sesi AE-50 — GPS distance dari outlet center */}
        {detail.cell.gpsDistanceMeters !== undefined &&
        detail.cell.gpsDistanceMeters !== null ? (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <span className="text-neutral-600">📍 Jarak dari outlet</span>
            <span className="font-mono text-xs text-neutral-700">
              {detail.cell.gpsDistanceMeters}m
            </span>
          </div>
        ) : null}

        {/* Sesi AE-50 — Selfie preview + Drive links */}
        {detail.cell.selfieDriveUrl ? (
          <div className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
                Selfie & Drive
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={detail.cell.selfieDriveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-mahakan-green-700 px-3 py-2 text-xs font-semibold text-white hover:bg-mahakan-green-700/90"
              >
                📷 Buka Foto Selfie
              </a>
              {detail.cell.selfieDriveFolderUrl ? (
                <a
                  href={detail.cell.selfieDriveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-mahakan-green-700 bg-white px-3 py-2 text-xs font-semibold text-mahakan-green-900 hover:bg-mahakan-green-50"
                >
                  📁 Folder Hari Ini
                </a>
              ) : null}
              <a
                href="https://drive.google.com/drive/folders/root"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                📂 Drive Mahakan
              </a>
            </div>
            <p className="mt-2 text-[10px] text-neutral-500">
              &ldquo;Folder Hari Ini&rdquo; buka folder Drive berisi semua
              selfie karyawan ini di tanggal{" "}
              {new Date(`${detail.date}T00:00:00Z`).toLocaleDateString(
                "id-ID",
                { day: "numeric", month: "short" },
              )}{" "}
              (clock-in + clock-out).
            </p>
          </div>
        ) : null}

        {detail.cell.status === "alpa" && formMode !== "create" ? (
          <p className="rounded-md border border-danger-300 bg-danger-100/40 p-3 text-xs text-danger-500">
            ⚠️ Karyawan dijadwalkan kerja tapi tidak ada record clock-in.
            {canCreate ? (
              <span className="mt-1 block text-neutral-600">
                Kalau sebenarnya hadir (lupa absen / data lama), klik{" "}
                <span className="font-semibold text-mahakan-green-900">
                  Tandai Hadir
                </span>{" "}
                di bawah.
              </span>
            ) : null}
          </p>
        ) : null}
        {detail.cell.status === "off" ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            Hari libur sesuai schedule.
          </p>
        ) : null}
        {detail.cell.status === "kosong" ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            Tidak ada schedule + tidak ada record absen.
          </p>
        ) : null}
      </div>

      {/* Sesi AE-162 — konfirmasi hapus entri manual. */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Hapus entri absen manual?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Batal
            </Button>
            <Button variant="destructive" onClick={onDelete} loading={deleting}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Entri Hadir manual untuk{" "}
          <span className="font-semibold">{detail.employeeName}</span> di
          tanggal ini akan dihapus dan kembali jadi{" "}
          <span className="font-semibold text-danger-500">Alpa</span>. Payroll
          perlu di-Recompute setelah ini.
        </p>
      </Modal>
    </Modal>
  );
}

/** Format "HH:MM[:SS]" → "HH:MM". */
function formatHm(hms: string): string {
  return hms.slice(0, 5);
}

/**
 * Sesi AE-162 — Backfill Hadir massal. HR Bayu: tandai Hadir semua hari
 * Alpa (terjadwal kerja, lewat, belum ada record) dalam rentang tanggal.
 * Power-tool buat mock data historis (mis. tgl 1–13 sebelum app dipakai)
 * tanpa klik per sel. Jam ikut shift terjadwal.
 */
function BulkBackfillModal({
  employees,
  defaultFrom,
  defaultTo,
  onClose,
  onDone,
}: {
  employees: ActiveEmployee[];
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(employees.map((e) => e.id)),
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allSelected = selectedIds.size === employees.length;

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(
      allSelected ? new Set() : new Set(employees.map((e) => e.id)),
    );
  }

  async function onSubmit() {
    if (submitting) return;
    if (to < from) {
      toast.error("Tanggal akhir harus >= tanggal mulai");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Pilih minimal 1 karyawan");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter (mis. 'rekap absen manual Mei')");
      return;
    }
    setSubmitting(true);
    const res = await bulkBackfillAttendance({
      from,
      to,
      employeeIds: allSelected ? undefined : Array.from(selectedIds),
      isLate: "no",
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.created === 0) {
      toast.success(
        "Tidak ada hari Alpa yang perlu ditandai di rentang ini (mungkin sudah terisi semua).",
      );
    } else {
      toast.success(`${res.data.created} hari ditandai Hadir 🎉`);
    }
    onDone();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Backfill Hadir Massal"
      description="Tandai Hadir semua hari Alpa (terjadwal kerja, sudah lewat, belum ada absen) dalam rentang tanggal."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            <CalendarCheck className="size-4" aria-hidden /> Backfill Hadir
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="bf-from"
              className="block text-xs font-medium text-neutral-900"
            >
              Tanggal mulai
            </label>
            <input
              id="bf-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="bf-to"
              className="block text-xs font-medium text-neutral-900"
            >
              Tanggal sampai
            </label>
            <input
              id="bf-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Karyawan ({selectedIds.size}/{employees.length})
            </label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-mahakan-green-700 hover:underline"
            >
              {allSelected ? "Hapus semua" : "Pilih semua"}
            </button>
          </div>
          <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 sm:grid-cols-2">
            {employees.map((e) => {
              const checked = selectedIds.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    checked
                      ? "border-mahakan-green-700 bg-mahakan-green-50"
                      : "border-neutral-200 bg-white hover:bg-neutral-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 flex-none items-center justify-center rounded border",
                      checked
                        ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                        : "border-neutral-300 bg-white",
                    )}
                    aria-hidden
                  >
                    {checked ? <CheckCircle2 className="size-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-900">
                      {e.fullName}
                    </span>
                    {e.position ? (
                      <span className="block truncate text-[10px] text-neutral-500">
                        {e.position}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Input
          label="Alasan (wajib, min 3 karakter)"
          placeholder="mis. rekap absen manual sebelum app dipakai"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />

        <div className="rounded-md border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-3 text-xs text-neutral-700">
          <p className="font-semibold text-mahakan-green-900">
            Yang akan terjadi:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>Hanya hari Alpa (terjadwal kerja, sudah lewat) yang ditandai.</li>
            <li>Hari libur (Off) &amp; yang sudah ada absen dilewati otomatis.</li>
            <li>Jam kerja ikut shift terjadwal masing-masing.</li>
            <li>Entri ditandai &ldquo;input manual&rdquo; &amp; ter-audit.</li>
            <li>Jalankan Recompute di Payroll setelah ini.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** Format clockInAt/clockOutAt ISO ke WIB "HH:mm". */
function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Sesi AE-53 — Bulk Assign Schedule modal. HR pick employees + date
 * range + template, server insert rows (skip existing dates).
 */
function BulkAssignDialog({
  employees,
  templates,
  weekStart,
  onClose,
  onSaved,
}: {
  employees: ActiveEmployee[];
  templates: ReadonlyArray<{ label: string; start: string; end: string }>;
  weekStart: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(
    () => new Set(employees.map((e) => e.id)),
  );
  const [rangeMode, setRangeMode] = useState<
    "this_week" | "next_week" | "this_month" | "custom"
  >("this_week");
  const [customStart, setCustomStart] = useState(isoDate(weekStart));
  const [customEnd, setCustomEnd] = useState(isoDate(addDays(weekStart, 6)));
  /* Sesi AE-54 — owner request: bisa pilih hari tertentu (mis. cuma Senin
   * + Rabu + Jumat untuk libur tertentu, atau cuma Sabtu shift weekend).
   * Pre-AE-54: cuma boolean includeWeekend. Sekarang Set hari tertentu
   * dengan 7 toggle. Default semua hari aktif (matches existing behavior). */
  const [selectedDays, setSelectedDays] = useState<Set<number>>(
    () => new Set([0, 1, 2, 3, 4, 5, 6]),
  );
  const [templateIdx, setTemplateIdx] = useState(0);
  const [markOff, setMarkOff] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    let start: Date;
    let end: Date;
    if (rangeMode === "this_week") {
      start = weekStart;
      end = addDays(weekStart, 6);
    } else if (rangeMode === "next_week") {
      start = addDays(weekStart, 7);
      end = addDays(weekStart, 13);
    } else if (rangeMode === "this_month") {
      const d = new Date(weekStart);
      start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    } else {
      start = new Date(`${customStart}T00:00:00Z`);
      end = new Date(`${customEnd}T00:00:00Z`);
    }
    const out: string[] = [];
    const cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime()) {
      const dow = cursor.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (selectedDays.has(dow)) {
        out.push(isoDate(cursor));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }, [rangeMode, weekStart, customStart, customEnd, selectedDays]);

  function toggleDay(dow: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  const tpl = templates[templateIdx];

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (submitting) return;
    setError(null);
    if (selectedEmployees.size === 0) {
      setError("Pilih minimal 1 karyawan");
      return;
    }
    if (dates.length === 0) {
      setError("Range tanggal kosong");
      return;
    }
    if (!markOff && !tpl) {
      setError("Pilih template");
      return;
    }
    setSubmitting(true);
    const res = await bulkAssignSchedule({
      employeeIds: Array.from(selectedEmployees),
      dates,
      template: markOff
        ? { dayOff: true }
        : { dayOff: false, startTime: tpl!.start, endTime: tpl!.end },
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(
      `${res.data.created} jadwal dibuat${res.data.skipped > 0 ? `, ${res.data.skipped} dilewati (sudah ada)` : ""}`,
    );
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk Assign Jadwal"
      description={`Apply 1 template ke banyak karyawan × tanggal sekaligus. Skip tanggal yang sudah ada jadwal.`}
      size="lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSave} loading={submitting} size="lg">
            Apply ke {selectedEmployees.size} × {dates.length} jadwal
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Karyawan ({selectedEmployees.size}/{employees.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelectedEmployees(new Set(employees.map((e) => e.id)))
              }
            >
              Semua
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedEmployees(new Set())}
            >
              Hapus
            </Button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {employees.map((e) => {
              const active = selectedEmployees.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggleEmployee(e.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    active
                      ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    readOnly
                    className="size-3.5"
                  />
                  <span className="truncate font-medium">{e.fullName}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Range Tanggal ({dates.length} hari)
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(
              [
                { v: "this_week", l: "Minggu Ini" },
                { v: "next_week", l: "Minggu Depan" },
                { v: "this_month", l: "Bulan Ini" },
                { v: "custom", l: "Custom" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setRangeMode(opt.v)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  rangeMode === opt.v
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {rangeMode === "custom" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                label="Dari"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <Input
                label="Sampai"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          ) : null}
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Pilih hari
            </p>
            <div className="grid grid-cols-7 gap-1">
              {[
                { dow: 1, label: "Sen" },
                { dow: 2, label: "Sel" },
                { dow: 3, label: "Rab" },
                { dow: 4, label: "Kam" },
                { dow: 5, label: "Jum" },
                { dow: 6, label: "Sab" },
                { dow: 0, label: "Min" },
              ].map(({ dow, label }) => {
                const active = selectedDays.has(dow);
                const isWeekend = dow === 0 || dow === 6;
                return (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => toggleDay(dow)}
                    className={cn(
                      "rounded-md border py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? isWeekend
                          ? "border-amber-500 bg-amber-50 text-amber-900"
                          : "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))}
                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Semua hari
              </button>
              <button
                type="button"
                onClick={() => setSelectedDays(new Set([1, 2, 3, 4, 5]))}
                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Senin–Jumat
              </button>
              <button
                type="button"
                onClick={() => setSelectedDays(new Set([0, 6]))}
                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Weekend saja
              </button>
              <button
                type="button"
                onClick={() => setSelectedDays(new Set())}
                className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-500 hover:bg-neutral-50"
              >
                Reset
              </button>
            </div>
            <p className="pt-0.5 text-[11px] text-neutral-500">
              Tap hari untuk pilih. Cuma hari yang aktif yang akan di-assign / OFF.
            </p>
          </div>
        </section>

        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Template
          </p>
          <label className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-2 cursor-pointer">
            <input
              type="checkbox"
              checked={markOff}
              onChange={(e) => setMarkOff(e.target.checked)}
              className="size-4"
            />
            <span className="text-sm font-medium text-neutral-900">
              Tandai semua sebagai Hari libur (OFF)
            </span>
          </label>
          {!markOff ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {templates.map((t, i) => {
                const active = templateIdx === i;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setTemplateIdx(i)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-xs",
                      active
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    <span className="font-medium">{t.label}</span>
                    <span className="font-mono text-[10px] opacity-80">
                      {t.start}–{t.end}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        <Input
          label="Catatan (opsional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 200))}
          placeholder="Mis. shift soft-opening week"
        />

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Sesi AE-53 — Edit Shift Templates modal. HR edit jam Pagi/Siang/Sore/Full
 * (atau tambah template baru). Tersimpan di outlet.settings.scheduleTemplates.
 */
function EditTemplatesDialog({
  current,
  onClose,
  onSaved,
}: {
  current: ReadonlyArray<{ label: string; start: string; end: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(
    current.map((t) => ({ ...t })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(
    idx: number,
    patch: Partial<{ label: string; start: string; end: string }>,
  ) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    if (items.length >= 10) return;
    setItems((prev) => [
      ...prev,
      { label: "Baru", start: "09:00", end: "17:00" },
    ]);
  }
  function removeItem(idx: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function resetDefaults() {
    setItems(DEFAULT_SHIFT_TEMPLATES.map((t) => ({ ...t })));
  }

  async function handleSave() {
    if (submitting) return;
    setError(null);
    // Client-side validate (server juga validate via Zod).
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const t of items) {
      if (!t.label.trim()) {
        setError("Semua template butuh nama");
        return;
      }
      if (!re.test(t.start) || !re.test(t.end)) {
        setError(`Format jam HH:mm tidak valid (${t.label})`);
        return;
      }
    }
    setSubmitting(true);
    const res = await updateScheduleTemplates({
      templates: items.map((t) => ({
        label: t.label.trim(),
        start: t.start,
        end: t.end,
      })),
    });
    setSubmitting(false);
    if (!isOutletOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Template shift tersimpan");
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Template Shift"
      description="Atur jam preset (Pagi/Siang/Sore/Full atau custom). Dipakai di Edit Schedule + Bulk Assign."
      size="md"
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button variant="ghost" onClick={resetDefaults} disabled={submitting}>
            Reset Default
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={handleSave} loading={submitting}>
              Simpan
            </Button>
          </div>
        </div>
      }
    >
      {/* Sesi AE-54 — card layout per template dengan labeled fields supaya
       * lebih rapih + jelas mana name/start/end. */}
      <div className="space-y-2.5">
        <p className="text-xs text-neutral-600">
          Atur jam preset shift untuk outlet. Template muncul sebagai tombol
          quick-fill di Edit Schedule dan Bulk Assign.
        </p>
        {items.map((t, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-neutral-200 bg-white p-3"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <label
                  htmlFor={`tpl-name-${idx}`}
                  className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Nama Shift
                </label>
                <input
                  id={`tpl-name-${idx}`}
                  type="text"
                  value={t.label}
                  onChange={(e) =>
                    updateItem(idx, { label: e.target.value })
                  }
                  placeholder="mis. Pagi"
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                  maxLength={20}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`tpl-start-${idx}`}
                  className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Mulai
                </label>
                <input
                  id={`tpl-start-${idx}`}
                  type="time"
                  value={t.start}
                  onChange={(e) =>
                    updateItem(idx, { start: e.target.value })
                  }
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`tpl-end-${idx}`}
                  className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  Selesai
                </label>
                <input
                  id={`tpl-end-${idx}`}
                  type="time"
                  value={t.end}
                  onChange={(e) =>
                    updateItem(idx, { end: e.target.value })
                  }
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeItem(idx)}
                disabled={submitting || items.length <= 1}
                className="!text-danger-500 hover:!bg-danger-100/40"
                title={
                  items.length <= 1
                    ? "Minimal 1 template wajib ada"
                    : `Hapus ${t.label || "template"}`
                }
              >
                <Trash2Icon />
                <span className="sm:hidden ml-1">Hapus</span>
              </Button>
            </div>
          </div>
        ))}
        {items.length < 10 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={addItem}
            disabled={submitting}
            fullWidth
          >
            + Tambah Template
          </Button>
        ) : (
          <p className="text-center text-[11px] italic text-neutral-500">
            Maksimal 10 template
          </p>
        )}
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Trash2Icon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ScheduleCell({
  schedule,
  onClick,
}: {
  schedule: ScheduleWithEmployee | null;
  onClick: () => void;
}) {
  if (!schedule) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-1.5 text-xs text-neutral-400 hover:border-neutral-400 hover:bg-neutral-100"
      >
        +
      </button>
    );
  }
  if (schedule.dayOff) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md border border-warning-500/40 bg-warning-100/30 p-1.5 text-xs font-medium text-warning-500 hover:bg-warning-100/50"
      >
        OFF
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-mahakan-green-300 bg-mahakan-green-50 p-1.5 text-xs font-mono font-semibold text-mahakan-green-900 hover:bg-mahakan-green-100"
    >
      {schedule.startTime?.slice(0, 5)}–{schedule.endTime?.slice(0, 5)}
    </button>
  );
}

function ScheduleEditDialog({
  editing,
  templates,
  onClose,
  onSaved,
}: {
  editing: {
    employee: ActiveEmployee;
    date: string;
    existing: ScheduleWithEmployee | null;
  } | null;
  /** Sesi AE-53 — templates dari outlet settings; fallback defaults
   * kalau owner belum custom. Pass dari parent supaya 1× fetch per
   * SchedulesSection lifecycle (di-share antara modal + bulk assign). */
  templates: ReadonlyArray<{ label: string; start: string; end: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dayOff, setDayOff] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDayOff(editing.existing?.dayOff ?? false);
    setStartTime(editing.existing?.startTime?.slice(0, 5) ?? "09:00");
    setEndTime(editing.existing?.endTime?.slice(0, 5) ?? "17:00");
    setNotes(editing.existing?.notes ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [editing]);

  if (!editing) return null;

  async function handleSave() {
    if (!editing) return;
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const res = await upsertSchedule({
      employeeId: editing.employee.id,
      scheduleDate: editing.date,
      dayOff,
      startTime: dayOff ? null : startTime,
      endTime: dayOff ? null : endTime,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Jadwal disimpan");
    onSaved();
  }

  async function handleDelete() {
    if (!editing?.existing) return;
    if (!confirm("Hapus jadwal ini?")) return;
    const res = await deleteSchedule(editing.existing.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Jadwal dihapus");
    onSaved();
  }

  const dateLabel = new Date(editing.date).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${editing.employee.fullName} — ${dateLabel}`}
      description="Set jam kerja atau tandai libur."
      size="md"
      footer={
        <>
          {editing.existing ? (
            <Button
              variant="ghost"
              onClick={handleDelete}
              className="!text-danger-500 hover:!bg-danger-100/40"
              disabled={submitting}
            >
              Hapus
            </Button>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={handleSave} loading={submitting} size="lg">
              Simpan
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dayOff}
            onChange={(e) => setDayOff(e.target.checked)}
            disabled={submitting}
            className="size-4"
          />
          <span className="text-sm font-medium text-neutral-900">
            Hari libur (OFF)
          </span>
        </label>
        {!dayOff ? (
          <>
            {/* Sesi AE-51 — quick template shift untuk percepat input HR.
             * Tap template = auto-fill startTime + endTime. Staff Mahakan
             * biasa pakai 4 pola: Pagi/Siang/Sore/Full Day. */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Template Cepat
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {templates.map((tpl) => {
                  const active =
                    startTime === tpl.start && endTime === tpl.end;
                  return (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => {
                        setStartTime(tpl.start);
                        setEndTime(tpl.end);
                      }}
                      disabled={submitting}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-xs transition-all",
                        active
                          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                          : "border-neutral-200 bg-white text-neutral-700 hover:border-mahakan-green-700/60 hover:bg-mahakan-green-50/40",
                        submitting && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <span className="font-medium">{tpl.label}</span>
                      <span className="font-mono text-[10px] opacity-80">
                        {tpl.start}–{tpl.end}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TimePicker
                label="Mulai"
                value={startTime || null}
                onChange={(v) => setStartTime(v ?? "")}
                disabled={submitting}
                clearable={false}
              />
              <TimePicker
                label="Selesai"
                value={endTime || null}
                onChange={(v) => setEndTime(v ?? "")}
                disabled={submitting}
                clearable={false}
              />
            </div>
          </>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="Mis. shift sore, swap dengan Andi"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            disabled={submitting}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* Sesi AE-61 — Stat card untuk Historis Absen summary. 4 metric:
 * Tingkat Kehadiran, Telat, Alpa, Upcoming. Color-coded by tone. */
function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  const toneClass = {
    success: "border-success-500/30 bg-success-50/40",
    warning: "border-warning-500/30 bg-warning-50/40",
    danger: "border-danger-500/30 bg-danger-50/40",
    info: "border-mahakan-green-300 bg-mahakan-green-50/40",
    neutral: "border-neutral-200 bg-white",
  }[tone];
  const valueToneClass = {
    success: "text-success-700",
    warning: "text-warning-700",
    danger: "text-danger-700",
    info: "text-mahakan-green-900",
    neutral: "text-neutral-900",
  }[tone];
  return (
    <div className={cn("rounded-lg border p-4", toneClass)}>
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-bold", valueToneClass)}>
        {value}
      </div>
      <div className="mt-1 text-xs leading-snug text-neutral-600">{hint}</div>
    </div>
  );
}
