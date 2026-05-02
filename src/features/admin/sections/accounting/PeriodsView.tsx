"use client";

import { useEffect, useState } from "react";
import { Plus, Lock, CheckCircle2, Calendar } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import {
  ensureCurrentPeriod,
  fetchPeriods,
} from "@/features/accounting/actions";
import type {
  PeriodStatus,
  PeriodSummary,
} from "@/features/accounting/types";

const MONTH_NAMES = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const STATUS_LABEL: Record<PeriodStatus, string> = {
  open: "Open",
  closed: "Closed",
  locked: "Locked",
};

const STATUS_VARIANT: Record<
  PeriodStatus,
  "warning" | "success" | "neutral"
> = {
  open: "warning",
  closed: "success",
  locked: "neutral",
};

export function PeriodsView() {
  const [rows, setRows] = useState<PeriodSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchPeriods();
      if (res.ok) setRows(res.data);
      else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function onEnsure() {
    setCreating(true);
    try {
      const res = await ensureCurrentPeriod();
      if (res.ok) {
        toast.success(
          `Periode ${res.data.periodYear}-${String(res.data.periodMonth).padStart(2, "0")} siap`,
        );
        void load();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-700">
          Periode bulanan (Asia/Jakarta calendar). State: <em>open</em> →{" "}
          <em>closed</em> (sesi V) → <em>locked</em> (irreversible).
        </p>
        <Button size="sm" onClick={onEnsure} disabled={creating} loading={creating}>
          <Plus className="size-4" /> Buat Periode Bulan Ini
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-10 text-center">
          <Calendar className="mx-auto size-10 text-neutral-300" aria-hidden />
          <h3 className="mt-3 text-sm font-medium text-neutral-700">
            Belum ada periode akuntansi
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Klik &ldquo;Buat Periode Bulan Ini&rdquo; untuk mulai.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 bg-white">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Periode
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Status
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                  Entri Aktif
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Tutup
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Lock
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 text-sm font-medium text-neutral-900">
                    {MONTH_NAMES[p.periodMonth]} {p.periodYear}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[p.status as PeriodStatus]}>
                      {p.status === "locked" ? (
                        <Lock className="size-3" />
                      ) : p.status === "closed" ? (
                        <CheckCircle2 className="size-3" />
                      ) : null}
                      {STATUS_LABEL[p.status as PeriodStatus]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-neutral-700">
                    {p.entryCount}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {p.closedAt
                      ? new Date(p.closedAt).toLocaleDateString("id-ID")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {p.lockedAt
                      ? new Date(p.lockedAt).toLocaleDateString("id-ID")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Aksi tutup / lock periode + closing entry akan tersedia di sesi V
        (Reports + Period Close milestone).
      </p>
    </div>
  );
}
