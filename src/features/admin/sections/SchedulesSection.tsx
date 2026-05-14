"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Pencil,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Modal,
  Skeleton,
  TimePicker,
  toast,
} from "@/components/ui";
import {
  copyWeekSchedules,
  deleteSchedule,
  isOk,
  listActiveEmployees,
  listSchedules,
  upsertSchedule,
  type ScheduleWithEmployee,
} from "@/features/schedules";
import {
  getAttendanceCalendar,
  isOk as hrIsOk,
  type AttendanceCalendar,
  type AttendanceCalendarCell,
  type AttendanceDayStatus,
} from "@/features/hr-reports";
import { cn } from "@/lib/utils";

const DAYS_OF_WEEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

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
 *  berisi historis absen (Hadir/Telat/Off/Alpa). */
const ATTENDANCE_STYLE: Record<
  AttendanceDayStatus,
  { label: string; cellClass: string; legend: string }
> = {
  hadir: {
    label: "H",
    cellClass: "border-success-500/40 bg-success-100/60 text-success-500",
    legend: "Hadir",
  },
  telat: {
    label: "T",
    cellClass: "border-warning-500/40 bg-warning-100/60 text-warning-500",
    legend: "Telat",
  },
  off: {
    label: "Off",
    cellClass: "border-neutral-200 bg-neutral-100 text-neutral-600",
    legend: "Libur",
  },
  alpa: {
    label: "A",
    cellClass: "border-danger-500/40 bg-danger-100/60 text-danger-500",
    legend: "Alpa",
  },
  kosong: {
    label: "—",
    cellClass: "border-neutral-200 bg-white text-neutral-400",
    legend: "Tanpa Schedule",
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
    employeeName: string;
    date: string;
    cell: AttendanceCalendarCell;
  } | null>(null);
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<{
    employee: ActiveEmployee;
    date: string;
    existing: ScheduleWithEmployee | null;
  } | null>(null);

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

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "schedules"] });
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
        <div className="flex items-center gap-2">
          {viewMode === "schedule" ? (
            <Button variant="outline" onClick={handleCopyLastWeek}>
              <Copy className="size-4" aria-hidden /> Salin Minggu Lalu
            </Button>
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
        {viewMode === "attendance" ? (
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            {(["hadir", "telat", "off", "alpa", "kosong"] as const).map((s) => {
              const meta = ATTENDANCE_STYLE[s];
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 text-neutral-700"
                >
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded border text-[10px] font-bold",
                      meta.cellClass,
                    )}
                  >
                    {meta.label}
                  </span>
                  {meta.legend}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

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
                        {wkDates.map((d, i) => (
                          <th key={i} className="px-3 py-2 text-center">
                            <div>{DAYS_OF_WEEK[i]}</div>
                            <div className="font-mono text-[10px] text-neutral-400">
                              {d.toLocaleDateString("id-ID", {
                                day: "numeric",
                                month: "short",
                              })}
                            </div>
                          </th>
                        ))}
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
                            const existing =
                              scheduleMap.get(`${emp.id}::${dateIso}`) ?? null;
                            const cell =
                              attendanceByKey.get(`${emp.id}::${dateIso}`) ??
                              null;
                            return (
                              <td
                                key={dateIso}
                                className="px-2 py-2 text-center align-middle"
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
                                    onClick={() => {
                                      if (!cell) return;
                                      setAttendanceDetail({
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
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      <AttendanceDetailModal
        detail={attendanceDetail}
        onClose={() => setAttendanceDetail(null)}
      />
    </div>
  );
}

function AttendanceCell({
  cell,
  onClick,
}: {
  cell: AttendanceCalendarCell | null;
  onClick: () => void;
}) {
  if (!cell) {
    return (
      <span className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-xs text-neutral-400">
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1.5 text-xs font-bold transition-colors hover:brightness-95",
        meta.cellClass,
      )}
      title={meta.legend}
    >
      <span className="text-sm">{meta.label}</span>
      {lateBadge ? (
        <span className="text-[9px] font-mono opacity-80">+{lateBadge}</span>
      ) : null}
    </button>
  );
}

function AttendanceDetailModal({
  detail,
  onClose,
}: {
  detail: {
    employeeName: string;
    date: string;
    cell: AttendanceCalendarCell;
  } | null;
  onClose: () => void;
}) {
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
  return (
    <Modal
      open
      onClose={onClose}
      title={`Detail Absen — ${detail.employeeName}`}
      description={dateLabel}
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
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

        {detail.cell.status === "alpa" ? (
          <p className="rounded-md border border-danger-300 bg-danger-100/40 p-3 text-xs text-danger-500">
            ⚠️ Karyawan dijadwalkan kerja tapi tidak ada record clock-in.
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
  onClose,
  onSaved,
}: {
  editing: {
    employee: ActiveEmployee;
    date: string;
    existing: ScheduleWithEmployee | null;
  } | null;
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
