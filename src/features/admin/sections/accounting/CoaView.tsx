"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Lock, AlertCircle, FileText } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import { fetchAccounts } from "@/features/accounting/actions";
import type {
  AccountListRow,
  AccountType,
  ChartOfAccount,
} from "@/features/accounting/types";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { AccountFormModal } from "./AccountFormModal";
import { ExportWorkbookButton } from "../ExportWorkbookButton";
import { downloadCsvForExcel } from "../reports/report-export";
import type { StyledSheet } from "@/lib/xlsx-styled";
import {
  buildCoaSheet,
  COA_TYPE_LABEL as TYPE_LABEL,
  coaCsvRows,
  sortByCode,
} from "./coa-export";
import { todayJakarta } from "@/lib/tz";


const TYPE_FILTERS: Array<{ key: AccountType | "all"; label: string }> = [
  { key: "all", label: "Semua" },
  { key: "asset", label: "Aset" },
  { key: "liability", label: "Kewajiban" },
  { key: "equity", label: "Ekuitas" },
  { key: "revenue", label: "Pendapatan" },
  { key: "cogs", label: "HPP" },
  { key: "expense", label: "Beban" },
];

interface Props {
  viewerRole: Role;
}

export function CoaView({ viewerRole }: Props) {
  const [filter, setFilter] = useState<AccountType | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AccountListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);

  const canManage = hasPermission(viewerRole, "accounting.coa.manage");

  async function load() {
    setLoading(true);
    try {
      const res = await fetchAccounts({
        type: filter === "all" ? undefined : filter,
      });
      if (res.ok) setRows(res.data);
      else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [filter]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!showInactive && !r.isActive) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, search, showInactive]);

  /* Sesi AE-238 — unduh Bagan Akun. Isinya = yang sedang tampil (filter
   * tipe, pencarian, nonaktif), diurutkan per kode supaya rapi dibaca. */
  const exportRows = useMemo(
    () => sortByCode(filtered),
    [filtered],
  );
  const filterLabel = [
    TYPE_FILTERS.find((f) => f.key === filter)?.label ?? "Semua",
    showInactive ? "termasuk nonaktif" : "aktif saja",
    search.trim() ? `cari "${search.trim()}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const fileBase = `bagan-akun-${todayJakarta()}`;

  async function downloadExcel() {
    if (exportRows.length === 0) throw new Error("EMPTY");
    const { downloadStyledXlsx } = await import("@/lib/xlsx-styled");
    const sheet = buildCoaSheet(exportRows, filterLabel, todayJakarta());
    await downloadStyledXlsx(fileBase, [sheet] as unknown as Array<StyledSheet<never>>);
  }

  function downloadCsv() {
    downloadCsvForExcel(fileBase, coaCsvRows(exportRows));
    toast.success("Berkas CSV diunduh");
  }

  function onCreated() {
    setCreateOpen(false);
    void load();
  }

  function onUpdated() {
    setEditing(null);
    void load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-mahakan-green-700 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari kode / nama akun..."
          className="ml-auto h-9 w-48 rounded-md border border-neutral-200 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700"
        />

        <label className="flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-3.5 rounded border-neutral-300"
          />
          Tampilkan nonaktif
        </label>

        <ExportWorkbookButton build={downloadExcel} label="Excel" />
        <Button
          variant="outline"
          size="sm"
          onClick={downloadCsv}
          disabled={loading || exportRows.length === 0}
        >
          <FileText className="size-4" /> CSV
        </Button>

        {canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Tambah Akun
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
          {rows.length === 0
            ? "Bagan Akun belum di-seed. Run `npm run seed:accounts -- --apply` di server."
            : "Tidak ada akun yang cocok dengan filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 bg-white">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Kode
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Nama Akun
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Tipe
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Normal
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Status
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((acc) => (
                <tr
                  key={acc.id}
                  className={cn(
                    "transition-colors hover:bg-neutral-50",
                    !acc.isActive && "opacity-60",
                  )}
                >
                  <td className="px-3 py-2 font-mono text-sm font-medium text-neutral-900">
                    {acc.code}
                  </td>
                  <td className="px-3 py-2 text-sm text-neutral-800">
                    <div className="flex items-center gap-2">
                      <span>{acc.name}</span>
                      {acc.isContra ? (
                        <Badge variant="neutral">kontra</Badge>
                      ) : null}
                      {acc.isSystem ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-neutral-500">
                          <Lock className="size-3" /> sistem
                        </span>
                      ) : null}
                    </div>
                    {acc.notes ? (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {acc.notes}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-sm text-neutral-700">
                    {TYPE_LABEL[acc.type]}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <Badge variant="neutral">
                      {acc.normalBalance === "debit" ? "Debit" : "Credit"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {acc.isActive ? (
                      <Badge variant="success">Aktif</Badge>
                    ) : (
                      <Badge variant="neutral">Nonaktif</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => setEditing(acc)}
                        className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                        aria-label={`Edit ${acc.code}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-neutral-500">
        <AlertCircle className="mt-0.5 size-3 shrink-0" /> Akun sistem
        (terkunci) wajib ada untuk auto-jurnal POS / payroll / setoran. Hanya
        kolom catatan + display order yang boleh diubah.
      </p>

      {createOpen ? (
        <AccountFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={onCreated}
        />
      ) : null}
      {editing ? (
        <AccountFormModal
          mode="edit"
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={onUpdated}
        />
      ) : null}
    </div>
  );
}
