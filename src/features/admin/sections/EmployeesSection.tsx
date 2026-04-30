"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  FileText as FileTextIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteEmployee,
  getEmployee,
  isOk,
  listEmployees,
  type Employee,
  type EmployeeStatus,
  type EmployeeWithLink,
} from "@/features/employees";
import { EmployeeFormModal } from "./employees/EmployeeFormModal";
import { EmployeeDocsModal } from "./employees/EmployeeDocsModal";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ value: EmployeeStatus | "all"; label: string }> =
  [
    { value: "all", label: "Semua" },
    { value: "active", label: "Aktif" },
    { value: "on_leave", label: "Cuti" },
    { value: "resigned", label: "Resign" },
    { value: "terminated", label: "Terminated" },
  ];

const STATUS_BADGE: Record<EmployeeStatus, { variant: "success" | "neutral" | "warning" | "danger"; label: string }> =
  {
    active: { variant: "success", label: "Aktif" },
    on_leave: { variant: "warning", label: "Cuti" },
    resigned: { variant: "neutral", label: "Resign" },
    terminated: { variant: "danger", label: "Terminated" },
  };

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Kontrak",
  freelance: "Freelance",
};

export function EmployeesSection() {
  const [items, setItems] = useState<EmployeeWithLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | "all">(
    "all",
  );
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<Employee | null>(null);
  const [docsFor, setDocsFor] = useState<Employee | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listEmployees({
        status: statusFilter,
        search: search.trim() || undefined,
      });
      if (cancelled) return;
      if (isOk(res)) setItems(res.data.items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, statusFilter, search]);

  const counts = useMemo(() => {
    const byStatus: Record<EmployeeStatus, number> = {
      active: 0,
      on_leave: 0,
      resigned: 0,
      terminated: 0,
    };
    for (const e of items) byStatus[e.status as EmployeeStatus]++;
    return byStatus;
  }, [items]);

  async function openEdit(emp: EmployeeWithLink) {
    const res = await getEmployee(emp.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setFormInitial(res.data);
    setFormOpen(true);
  }

  async function openDocs(emp: EmployeeWithLink) {
    const res = await getEmployee(emp.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setDocsFor(res.data);
  }

  async function handleDelete(emp: EmployeeWithLink) {
    if (
      !confirm(
        `Hapus karyawan "${emp.fullName}"? Data akan di-soft-delete dan dapat di-restore manual via DB.`,
      )
    )
      return;
    const res = await deleteEmployee(emp.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${emp.fullName} dihapus`);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <Users className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Karyawan
            </h1>
            <p className="text-sm text-neutral-600">
              Master data HR — terpisah dari user login. Lihat tab Staff
              untuk akun POS.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setFormInitial(null);
            setFormOpen(true);
          }}
          size="lg"
        >
          <Plus className="size-4" aria-hidden /> Tambah Karyawan
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(counts) as EmployeeStatus[]).map((s) => (
          <Card key={s}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                {STATUS_BADGE[s].label}
              </p>
              <p className="mt-1 text-2xl font-bold text-neutral-900">
                {counts[s]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-all",
                    statusFilter === f.value
                      ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative max-w-xs flex-1">
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama / posisi / no. karyawan..."
                className="w-full rounded-md border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertCircle className="size-8 text-neutral-300" aria-hidden />
              <p className="text-sm font-medium text-neutral-700">
                Belum ada karyawan
              </p>
              <p className="text-xs text-neutral-500">
                Tap &ldquo;Tambah Karyawan&rdquo; untuk mulai.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Nama</th>
                    <th className="px-4 py-2">Posisi · Departemen</th>
                    <th className="px-4 py-2">Tipe · Gaji</th>
                    <th className="px-4 py-2">Akun POS</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Dokumen</th>
                    <th className="px-4 py-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((emp) => {
                    const status = STATUS_BADGE[emp.status as EmployeeStatus];
                    return (
                      <tr
                        key={emp.id}
                        className="border-b border-neutral-100 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-900">
                            {emp.fullName}
                            {emp.nickname ? (
                              <span className="ml-1 text-xs text-neutral-500">
                                ({emp.nickname})
                              </span>
                            ) : null}
                          </div>
                          {emp.employeeNumber ? (
                            <div className="font-mono text-xs text-neutral-500">
                              {emp.employeeNumber}
                            </div>
                          ) : null}
                          {emp.phone ? (
                            <div className="text-xs text-neutral-500">
                              {emp.phone}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-neutral-900">
                            {emp.position ?? "—"}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {emp.department ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-neutral-900">
                            {emp.employmentType
                              ? EMPLOYMENT_TYPE_LABELS[emp.employmentType] ??
                                emp.employmentType
                              : "—"}
                          </div>
                          <div className="font-mono text-xs text-neutral-500">
                            {emp.salaryAmount != null
                              ? formatRupiah(emp.salaryAmount)
                              : "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {emp.linkedUserName ? (
                            <div>
                              <div>{emp.linkedUserName}</div>
                              {emp.linkedUserEmail ? (
                                <div className="text-neutral-500">
                                  {emp.linkedUserEmail}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openDocs(emp)}
                            className="inline-flex items-center gap-1 text-xs text-mahakan-green-700 hover:underline"
                          >
                            <FileTextIcon className="size-3.5" aria-hidden />
                            {emp.documentsCount} dok
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(emp)}
                            >
                              <Pencil className="size-3.5" aria-hidden /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(emp)}
                              className="!text-danger-500 hover:!bg-danger-100/40"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <EmployeeFormModal
        open={formOpen}
        initial={formInitial}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />

      <EmployeeDocsModal
        open={docsFor !== null}
        employee={docsFor}
        onClose={() => setDocsFor(null)}
      />
    </div>
  );
}
