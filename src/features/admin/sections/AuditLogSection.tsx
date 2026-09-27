"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Select,
  DatePicker,
  ResponsiveTable,
  toast,
  type ResponsiveColumn,
  type SelectGroup,
} from "@/components/ui";
import { listAuditLogs } from "@/features/audit";
import type { AuditLogRow } from "@/lib/audit";
import { AUDIT_EVENT_TYPES, isStaffVisibleEvent } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { todayWibIso } from "@/features/cash/helpers";
import { downloadCsvForExcel } from "./reports/report-export";
import {
  auditRecordToCsvRow,
  buildAuditStyledSheets,
  toAuditRecords,
} from "./audit-export";
import type { Role } from "@/lib/auth";

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
  {
    label: "Akuntansi",
    types: AUDIT_EVENT_TYPES.filter(
      (t) =>
        t.startsWith("chart_of_accounts.") ||
        t.startsWith("accounting_period.") ||
        t.startsWith("journal_entry.") ||
        t.startsWith("fixed_asset.") ||
        t === "opening_balance.posted" ||
        t === "report.income_statement.export" ||
        t === "report.balance_sheet.export",
    ) as string[],
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

interface AuditLogSectionProps {
  /** Sesi AE-62u — viewer role untuk gating filter dropdown + copy badge.
   * Owner = lihat semua event. Manager/supervisor = aksi staff saja
   * (server-side enforced, ini UI hint). */
  viewerRole: Role;
}

export function AuditLogSection({ viewerRole }: AuditLogSectionProps) {
  const isOwner = viewerRole === "owner";
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

  const {
    data,
    isLoading: loading,
  } = useQuery({
    queryKey: [
      "admin",
      "audit-logs",
      { eventType, fromDate, toDate, page },
    ],
    queryFn: async () => {
      const r = await listAuditLogs({
        eventType: eventType === "all" ? undefined : (eventType as never),
        fromDate,
        toDate,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (!r.ok) throw new Error("Gagal load audit logs");
      return r.data;
    },
    // Audit log fast-changing — keep stale time short
    staleTime: 30 * 1000,
  });

  const queryClient = useQueryClient();
  const rows = data?.rows ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "audit-logs"] });

  async function onExport(kind: "xlsx" | "csv") {
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
      toast.error("Gagal memuat audit log untuk diunduh");
      return;
    }
    if (r.data.rows.length === 0) {
      toast.info("Tidak ada catatan untuk filter ini");
      return;
    }
    if (r.data.total > EXPORT_CAP) {
      toast.warning(
        `Total ${r.data.total} catatan, unduhan dibatasi ${EXPORT_CAP} terbaru. Persempit rentang tanggal untuk mengunduh semuanya.`,
      );
    }
    const records = toAuditRecords(r.data.rows);
    const tag = eventType === "all" ? "semua" : eventType.replace(/\./g, "-");
    const base = `audit-log-${fromDate}-sd-${toDate}-${tag}`;
    try {
      if (kind === "xlsx") {
        // exceljs (~900KB) is loaded lazily inside downloadStyledXlsx.
        const { downloadStyledXlsx } = await import("@/lib/xlsx-styled");
        await downloadStyledXlsx(
          base,
          buildAuditStyledSheets(records, {
            from: fromDate,
            to: toDate,
            filter: eventType === "all" ? "semua aktivitas" : eventType,
          }),
        );
      } else {
        downloadCsvForExcel(base, records.map(auditRecordToCsvRow));
      }
      toast.success(`${r.data.rows.length} catatan diunduh`);
    } catch {
      toast.error("Gagal menyiapkan berkas unduhan");
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-mahakan-green-900">
            Audit Log
          </h1>
          <p className="text-sm text-neutral-600">
            {isOwner ? (
              <>
                Catatan aktivitas sistem (login, void, refund, perubahan menu,
                pengaturan, payroll, dll).
              </>
            ) : (
              <>
                Catatan aktivitas staff (login, void, refund, attendance, opname,
                purchase request, dll). Aksi sensitive (settings, payroll, user
                CRUD, akuntansi) hanya tampil untuk Owner.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onExport("xlsx")}
            disabled={exporting || !rows || rows.length === 0}
          >
            <FileSpreadsheet className="size-4" />
            {exporting ? "Memuat..." : "Excel"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onExport("csv")}
            disabled={exporting || !rows || rows.length === 0}
          >
            <FileText className="size-4" /> CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
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
              /* Sesi AE-62u — strip restricted event types dari dropdown
               * untuk non-owner supaya tidak muncul opsi yang return empty. */
              EVENT_GROUPS.map<SelectGroup>((g) => ({
                label: g.label,
                options: g.types
                  .filter((t) => isOwner || isStaffVisibleEvent(t))
                  .map((t) => ({ value: t, label: t })),
              })).filter((g) => g.options.length > 0)
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
          <div className="p-12 text-center text-sm text-neutral-600">
            Belum ada catatan untuk filter ini.
          </div>
        ) : (
          <div className="px-3 py-3 pointer:px-0 pointer:py-0">
            <ResponsiveTable<AuditLogRow>
              rows={rows}
              rowKey={(r) => r.id}
              columns={auditColumns(expanded, setExpanded)}
            />
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

/** Sesi AE-235 — crew who did the action on the POS (tablet login is userName). */
function crewName(r: AuditLogRow): string | null {
  const crew = r.metadata?.crew;
  return crew && typeof crew === "object" && "name" in crew && typeof crew.name === "string"
    ? crew.name
    : null;
}

function auditColumns(
  expanded: string | null,
  setExpanded: (id: string | null) => void,
): ResponsiveColumn<AuditLogRow>[] {
  return [
    {
      key: "createdAt",
      label: "Waktu",
      width: "w-40",
      render: (r) => (
        <span className="text-xs text-neutral-600">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: "eventType",
      label: "Event",
      primary: true,
      width: "w-44",
      render: (r) => {
        const tone = EVENT_TONE[r.eventType] ?? "info";
        return <Badge variant={tone}>{r.eventType}</Badge>;
      },
    },
    {
      key: "actor",
      label: "Pelaku",
      width: "w-44",
      render: (r) => (
        <div className="text-xs text-neutral-700">
          {r.userName ? (
            <>
              <div className="font-medium">{r.userName}</div>
              <div className="text-[11px] text-neutral-600">{r.userRole}</div>
            </>
          ) : (
            <span className="text-neutral-400">—</span>
          )}
          {crewName(r) ? (
            <div className="mt-1 text-[11px] font-medium text-neutral-800">
              crew: {crewName(r)}
            </div>
          ) : null}
          {r.approverName ? (
            <div className="mt-1 text-[11px] text-mahakan-green-700">
              ✓ approved by {r.approverName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "summary",
      label: "Ringkasan",
      render: (r) => {
        const summary =
          (r.payload?.summary as string | undefined) ?? r.eventType;
        const isOpen = expanded === r.id;
        const hasDetail = Boolean(r.payload?.diff || r.payload?.context);
        return (
          <div>
            <div className="text-neutral-900">{summary}</div>
            {hasDetail ? (
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                className="mt-1 text-xs text-mahakan-green-700 hover:underline"
              >
                {isOpen ? "Sembunyikan detail" : "Lihat detail"}
              </button>
            ) : null}
            {isOpen ? (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-700">
                {JSON.stringify(
                  { payload: r.payload, metadata: r.metadata },
                  null,
                  2,
                )}
              </pre>
            ) : null}
          </div>
        );
      },
    },
  ];
}
