"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  clockIn,
  clockOut,
  getTodayAttendanceStatus,
  isOk,
  listAttendance,
  type AttendanceRecordWithEmployee,
  type EmployeeAttendanceTodayStatus,
} from "@/features/attendance";
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updateAttendanceSettings,
} from "@/features/outlets";
import { todayWibIso } from "@/features/cash/helpers";
import { formatIndonesianTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type ViewMode = "kiosk" | "list";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function AttendanceSection() {
  const [mode, setMode] = useState<ViewMode>("kiosk");
  const [today, setToday] = useState<EmployeeAttendanceTodayStatus[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lateGrace, setLateGrace] = useState<string>("5");
  const [lateGraceLoaded, setLateGraceLoaded] = useState(false);
  const [savingGrace, setSavingGrace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (outletIsOk(res)) {
        const value = res.data.settings?.attendance?.lateGraceMinutes;
        if (typeof value === "number") setLateGrace(String(value));
        setLateGraceLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveGrace() {
    const minutes = parseInt(lateGrace, 10);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) {
      toast.error("Grace harus 0-60 menit");
      return;
    }
    setSavingGrace(true);
    const res = await updateAttendanceSettings({
      lateGraceMinutes: minutes,
    });
    setSavingGrace(false);
    if (!outletIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Late grace di-set ${minutes} menit`);
    setSettingsOpen(false);
  }

  // List mode state
  const [listDate, setListDate] = useState<string>(() => todayWibIso());
  const [listRows, setListRows] = useState<AttendanceRecordWithEmployee[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // Confirm modal — used for both clock-in and clock-out so kasir can
  // double-check + add an optional note.
  const [confirm, setConfirm] = useState<{
    kind: "clock_in" | "clock_out";
    employee: EmployeeAttendanceTodayStatus;
  } | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Tick — drives the "elapsed since clock-in" display.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingToday(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getTodayAttendanceStatus();
      if (cancelled) return;
      if (isOk(res)) setToday(res.data);
      setLoadingToday(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (mode !== "list") return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setListLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listAttendance({ date: listDate });
      if (cancelled) return;
      if (isOk(res)) setListRows(res.data.items);
      setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, listDate, refreshKey]);

  const summary = useMemo(() => {
    let active = 0;
    let done = 0;
    for (const e of today) {
      if (e.openRecordId !== null) active++;
      else if (e.hasClosedRecordToday) done++;
    }
    const total = today.length;
    const idle = total - active - done;
    return { active, done, idle, total };
  }, [today]);

  function openConfirm(
    kind: "clock_in" | "clock_out",
    employee: EmployeeAttendanceTodayStatus,
  ) {
    setConfirm({ kind, employee });
    setConfirmNote("");
  }

  async function executeConfirm() {
    if (!confirm) return;
    if (submitting) return;
    setSubmitting(true);
    const noteTrim = confirmNote.trim() || null;
    if (confirm.kind === "clock_in") {
      const res = await clockIn({
        employeeId: confirm.employee.employeeId,
        notes: noteTrim,
      });
      if (!isOk(res)) {
        toast.error(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Clock-in ${confirm.employee.employeeFullName}`);
    } else {
      if (!confirm.employee.openRecordId) {
        toast.error("Tidak ada record terbuka untuk karyawan ini");
        setSubmitting(false);
        return;
      }
      const res = await clockOut({
        recordId: confirm.employee.openRecordId,
        notes: noteTrim,
      });
      if (!isOk(res)) {
        toast.error(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Clock-out ${confirm.employee.employeeFullName}`);
    }
    setSubmitting(false);
    setConfirm(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <Clock className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Absensi
            </h1>
            <p className="text-sm text-neutral-600">
              Mode kiosk untuk clock-in / clock-out, plus list per hari.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={mode === "kiosk" ? undefined : "outline"}
            onClick={() => setMode("kiosk")}
          >
            <LayoutGrid className="size-4" aria-hidden /> Kiosk
          </Button>
          <Button
            variant={mode === "list" ? undefined : "outline"}
            onClick={() => setMode("list")}
          >
            <List className="size-4" aria-hidden /> List
          </Button>
          <Button
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            disabled={!lateGraceLoaded}
            aria-label="Pengaturan absensi"
          >
            <SettingsIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <Modal
        open={settingsOpen}
        onClose={() => (savingGrace ? null : setSettingsOpen(false))}
        title="Pengaturan Absensi"
        description="Toleransi keterlambatan menit. Default 5 menit."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setSettingsOpen(false)}
              disabled={savingGrace}
            >
              Batal
            </Button>
            <Button onClick={handleSaveGrace} loading={savingGrace} size="lg">
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Late Grace (menit)"
            type="number"
            min="0"
            max="60"
            value={lateGrace}
            onChange={(e) => setLateGrace(e.target.value)}
            hint="Karyawan clock-in dalam grace ini gak ditandai telat. Range 0-60."
            disabled={savingGrace}
          />
          <p className="rounded-md bg-mahakan-green-50 p-3 text-xs text-mahakan-green-900">
            Contoh: jadwal 09:00 + grace 5m → clock-in 09:03 = NOT late;
            clock-in 09:08 = LATE (3m).
          </p>
        </div>
      </Modal>

      {mode === "kiosk" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="On Floor" value={summary.active} variant="success" />
            <StatCard
              label="Sudah Selesai"
              value={summary.done}
              variant="neutral"
            />
            <StatCard label="Belum Masuk" value={summary.idle} variant="warning" />
            <StatCard label="Total Aktif" value={summary.total} variant="info" />
          </div>

          {loadingToday ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : today.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Calendar
                  className="size-8 text-neutral-300"
                  aria-hidden
                />
                <p className="text-sm font-medium text-neutral-700">
                  Belum ada karyawan aktif
                </p>
                <p className="text-xs text-neutral-500">
                  Tambah karyawan dengan status &ldquo;Aktif&rdquo; di tab
                  Karyawan dulu.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {today.map((e) => (
                <KioskCard
                  key={e.employeeId}
                  employee={e}
                  now={now}
                  onClockIn={() => openConfirm("clock_in", e)}
                  onClockOut={() => openConfirm("clock_out", e)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="space-y-3 px-6 py-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-neutral-900">
                Tanggal:
              </label>
              <input
                type="date"
                value={listDate}
                onChange={(e) => setListDate(e.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              />
            </div>
            {listLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : listRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm italic text-neutral-500">
                Tidak ada record di tanggal ini.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2">Clock In</th>
                      <th className="px-4 py-2">Clock Out</th>
                      <th className="px-4 py-2">Durasi</th>
                      <th className="px-4 py-2">Aktor</th>
                      <th className="px-4 py-2">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-neutral-100 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-900">
                            {r.employeeFullName}
                            {r.employeeNickname ? (
                              <span className="ml-1 text-xs text-neutral-500">
                                ({r.employeeNickname})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {r.employeePosition ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {formatIndonesianTime(r.clockInAt)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {r.clockOutAt ? (
                            formatIndonesianTime(r.clockOutAt)
                          ) : (
                            <Badge variant="success">On Floor</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {r.workMinutes != null
                            ? formatDuration(r.workMinutes)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          <div>in: {r.clockedInByName}</div>
                          {r.clockedOutByName ? (
                            <div>out: {r.clockedOutByName}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-600">
                          {r.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => (submitting ? null : setConfirm(null))}
        title={
          confirm?.kind === "clock_in"
            ? `Clock In — ${confirm.employee.employeeFullName}`
            : confirm
              ? `Clock Out — ${confirm.employee.employeeFullName}`
              : ""
        }
        description={
          confirm?.kind === "clock_in"
            ? "Konfirmasi waktu masuk. Catatan opsional."
            : "Konfirmasi waktu keluar. Catatan opsional."
        }
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirm(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              size="lg"
              onClick={executeConfirm}
              loading={submitting}
            >
              {confirm?.kind === "clock_in" ? "Clock In" : "Clock Out"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {confirm?.kind === "clock_out" && confirm.employee.openClockInAt ? (
            <p className="rounded-md bg-mahakan-green-50 p-3 text-sm text-mahakan-green-900">
              Masuk sejak{" "}
              <span className="font-mono font-semibold">
                {formatIndonesianTime(confirm.employee.openClockInAt)}
              </span>
              .
            </p>
          ) : null}
          <div>
            <label className="block text-sm font-medium text-neutral-900">
              Catatan (opsional)
            </label>
            <textarea
              value={confirmNote}
              onChange={(e) => setConfirmNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder={
                confirm?.kind === "clock_in"
                  ? "Misal: telat 15 menit, ada urusan keluarga"
                  : "Misal: lembur sampai bersih-bersih"
              }
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              disabled={submitting}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "neutral" | "warning" | "info";
}) {
  const colors: Record<typeof variant, string> = {
    success: "border-success-500/40 bg-success-100/30 text-success-500",
    neutral: "border-neutral-300 bg-neutral-50 text-neutral-700",
    warning: "border-warning-500/40 bg-warning-100/30 text-warning-500",
    info: "border-mahakan-green-200 bg-mahakan-green-50 text-mahakan-green-900",
  };
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        colors[variant],
      )}
    >
      <p className="text-xs uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

function KioskCard({
  employee,
  now,
  onClockIn,
  onClockOut,
}: {
  employee: EmployeeAttendanceTodayStatus;
  now: number;
  onClockIn: () => void;
  onClockOut: () => void;
}) {
  const isOnFloor = employee.openRecordId !== null;
  const elapsedMinutes =
    isOnFloor && employee.openClockInAt
      ? Math.max(
          0,
          Math.floor(
            (now - new Date(employee.openClockInAt).getTime()) / 60_000,
          ),
        )
      : 0;
  const isDone = employee.hasClosedRecordToday && !isOnFloor;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition-all",
        isOnFloor
          ? "border-success-500/50 bg-success-100/20"
          : isDone
            ? "border-neutral-200 bg-neutral-50 opacity-70"
            : "border-warning-500/40 bg-white",
      )}
    >
      <div
        className={cn(
          "flex size-16 items-center justify-center rounded-full text-xl font-bold",
          isOnFloor
            ? "bg-success-500 text-white"
            : isDone
              ? "bg-neutral-300 text-neutral-700"
              : "bg-warning-500 text-white",
        )}
      >
        {initials(employee.employeeFullName)}
      </div>
      <div className="text-center">
        <p className="font-semibold text-neutral-900 line-clamp-2">
          {employee.employeeFullName}
        </p>
        {employee.employeePosition ? (
          <p className="text-xs text-neutral-500">{employee.employeePosition}</p>
        ) : null}
      </div>
      {isOnFloor ? (
        <div className="text-center">
          <p className="text-xs text-success-500">
            On floor · {formatDuration(elapsedMinutes)}
          </p>
          <p className="font-mono text-[10px] text-neutral-500">
            {employee.openClockInAt
              ? `sejak ${formatIndonesianTime(employee.openClockInAt)}`
              : null}
          </p>
        </div>
      ) : isDone ? (
        <div className="flex items-center gap-1 text-xs text-neutral-600">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Selesai
        </div>
      ) : (
        <p className="text-xs text-neutral-500">Belum masuk</p>
      )}
      {isOnFloor ? (
        <Button onClick={onClockOut} fullWidth size="lg">
          <LogOut className="size-4" aria-hidden /> Clock Out
        </Button>
      ) : (
        <Button
          onClick={onClockIn}
          fullWidth
          size="lg"
          variant={isDone ? "outline" : undefined}
        >
          <LogIn className="size-4" aria-hidden /> Clock In
        </Button>
      )}
    </div>
  );
}
