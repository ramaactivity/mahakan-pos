"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import Papa from "papaparse";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Select, DatePicker, toast, type SelectGroup } from "@/components/ui";
import { listAuditLogs } from "@/features/audit";
import type { AuditLogRow } from "@/lib/audit";
import { AUDIT_EVENT_TYPES } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { todayWibIso } from "@/features/cash/helpers";
import { downloadCsv } from "./reports/menu-engineering-csv";

const EXPORT_CAP = 5000;

const PAGE_SIZE = 50;

const EVENT_GROUPS: Array<{ label: string; types: string[] }> = [
  {
    label: "Auth",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("auth.")) as string[],
  },
  {
    label: "Transaksi",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("transaction.")) as string[],
  },
  {
    label: "Menu",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("menu.")) as string[],
  },
  {
    label: "User",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("user.")) as string[],
  },
  {
    label: "Kas",
    types: AUDIT_EVENT_TYPES.filter(
      (t) =>
        t.startsWith("expense") || t.startsWith("income") || t.startsWith("expense_category"),
    ) as string[],
  },
  {
    label: "Settings",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("settings.")) as string[],
  },
  {
    label: "Inventory",
    types: AUDIT_EVENT_TYPES.filter((t) => t.startsWith("inventory.")) as string[],
  },
];

const EVENT_TONE: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  "auth.login.success": "success",
  "auth.login.failed": "danger",
  "auth.logout": "neutral",
  "transaction.void": "danger",
  "transaction.refund": "danger",
  "transaction.discount.applied": "warning",
  "menu.item.delete": "danger",
  "menu.category.delete": "danger",
  "user.deactivate": "danger",
  "user.reset_pin": "warning",
};

export function AuditLogSection() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState<string>("all");
  const today = useMemo(() => todayWibIso(), []);
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(today);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function load() {
    setLoading(true);
    const r = await listAuditLogs({
      eventType: eventType === "all" ? undefined : (eventType as never),
      fromDate,
      toDate,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    if (r.ok) {
      setRows(r.data.rows);
      setTotal(r.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, fromDate, toDate, page]);

  async function onExportCsv() {
    if (exporting) return;
    setExporting(true);
    const r = await listAuditLogs({
      eventType: eventType === "all" ? undefined : (eventType as never),
      fromDate,
      toDate,
      limit: EXPORT_CAP,
      offset: 0,
    });
    setExporting(false);
    if (!r.ok) {
      toast.error("Gagal load audit log untuk export");
      return;
    }
    if (r.data.rows.length === 0) {
      toast.info("Tidak ada entry untuk filter ini");
      return;
    }
    if (r.data.total > EXPORT_CAP) {
      toast.warning(
        `Total ${r.data.total} entry, export dibatasi ${EXPORT_CAP}. Persempit range tanggal untuk export semua.`,
      );
    }
    const csvData = r.data.rows.map((row) => ({
      Waktu: new Date(row.createdAt).toISOString(),
      Event: row.eventType,
      Pelaku: row.userName ?? "",
      Role: row.userRole ?? "",
      Approver: row.approverName ?? "",
      Entitas: row.entityType ?? "",
      "Entity ID": row.entityId ?? "",
      Ringkasan: (row.payload?.summary as string | undefined) ?? "",
      Konteks: row.payload?.context
        ? JSON.stringify(row.payload.context)
        : "",
      Diff: row.payload?.diff ? JSON.stringify(row.payload.diff) : "",
    }));
    const csv = Papa.unparse(csvData, { newline: "\n" });
    const tag = eventType === "all" ? "all" : eventType.replace(/\./g, "-");
    downloadCsv(`audit-log-${fromDate}-${toDate}-${tag}.csv`, csv);
    toast.success(`Export ${r.data.rows.length} entries`);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-mahakan-green-900">Audit Log</h1>
          <p className="text-sm text-neutral-600">
            Catatan aktivitas sistem (login, void, refund, perubahan harga, dll). Owner-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            disabled={exporting || !rows || rows.length === 0}
          >
            <Download className="size-4" />
            {exporting ? "Memuat..." : "CSV"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load()}
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Event"
            ariaLabel="Filter event type"
            options={[{ value: "all", label: "Semua" }]}
            groups={
              EVENT_GROUPS.map<SelectGroup>((g) => ({
                label: g.label,
                options: g.types.map((t) => ({ value: t, label: t })),
              }))
            }
            value={eventType}
            onValueChange={(v) => {
              setEventType(v);
              setPage(0);
            }}
          />
          <DatePicker
            label="Dari tanggal"
            value={fromDate}
            maxDate={toDate}
            onChange={(v) => {
              setFromDate(v ?? "");
              setPage(0);
            }}
            clearable={false}
          />
          <DatePicker
            label="Sampai tanggal"
            value={toDate}
            minDate={fromDate}
            maxDate={today}
            onChange={(v) => {
              setToDate(v ?? "");
              setPage(0);
            }}
            clearable={false}
          />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-neutral-500">
            Belum ada catatan untuk filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
                <tr>
                  <th className="w-40 px-4 py-3 font-medium">Waktu</th>
                  <th className="w-44 px-4 py-3 font-medium">Event</th>
                  <th className="w-44 px-4 py-3 font-medium">Pelaku</th>
                  <th className="px-4 py-3 font-medium">Ringkasan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone = EVENT_TONE[r.eventType] ?? "info";
                  const summary =
                    (r.payload?.summary as string | undefined) ?? r.eventType;
                  const isOpen = expanded === r.id;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-neutral-100 hover:bg-neutral-50"
                    >
                      <td className="px-4 py-3 align-top text-xs text-neutral-600">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge variant={tone}>{r.eventType}</Badge>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-neutral-700">
                        {r.userName ? (
                          <>
                            <div className="font-medium">{r.userName}</div>
                            <div className="text-[11px] text-neutral-500">
                              {r.userRole}
                            </div>
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                        {r.approverName && (
                          <div className="mt-1 text-[11px] text-mahakan-green-700">
                            ✓ approved by {r.approverName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-neutral-900">{summary}</div>
                        {Boolean(r.payload?.diff || r.payload?.context) && (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : r.id)}
                            className="mt-1 text-xs text-mahakan-green-700 hover:underline"
                          >
                            {isOpen ? "Sembunyikan detail" : "Lihat detail"}
                          </button>
                        )}
                        {isOpen && (
                          <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-700">
                            {JSON.stringify(
                              {
                                payload: r.payload,
                                metadata: r.metadata,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3 text-sm">
            <span className="text-neutral-600">
              Halaman {page + 1} / {totalPages} · total {total} entri
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
