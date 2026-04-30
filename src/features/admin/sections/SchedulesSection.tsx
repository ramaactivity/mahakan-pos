"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
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

export function SchedulesSection() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeekMonday(new Date()),
  );
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [schedules, setSchedules] = useState<ScheduleWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editing, setEditing] = useState<{
    employee: ActiveEmployee;
    date: string;
    existing: ScheduleWithEmployee | null;
  } | null>(null);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const fromIso = isoDate(weekDates[0]);
  const toIso = isoDate(weekDates[6]);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [empRes, schRes] = await Promise.all([
        listActiveEmployees(),
        listSchedules({ from: fromIso, to: toIso }),
      ]);
      if (cancelled) return;
      if (isOk(empRes)) setEmployees(empRes.data);
      if (isOk(schRes)) setSchedules(schRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, refreshKey]);

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
    setRefreshKey((k) => k + 1);
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
              Mingguan per karyawan. Tap cell untuk set jam atau tandai
              libur.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleCopyLastWeek}>
            <Copy className="size-4" aria-hidden /> Salin Minggu Lalu
          </Button>
          <Button variant="outline" onClick={() => navigateWeek(-7)}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <div className="rounded-md bg-white border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900">
            {weekDates[0].toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
            })}{" "}
            —{" "}
            {weekDates[6].toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <Button variant="outline" onClick={() => navigateWeek(7)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-2">
                      Karyawan
                    </th>
                    {weekDates.map((d, i) => (
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
                      {weekDates.map((d) => {
                        const dateIso = isoDate(d);
                        const existing =
                          scheduleMap.get(`${emp.id}::${dateIso}`) ?? null;
                        return (
                          <td
                            key={dateIso}
                            className="px-2 py-2 text-center align-middle"
                          >
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
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleEditDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
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
