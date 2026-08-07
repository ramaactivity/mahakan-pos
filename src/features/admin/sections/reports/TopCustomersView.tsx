"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Heart } from "lucide-react";
import Papa from "papaparse";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  isOk,
  topCustomers,
  type Customer,
} from "@/features/customers";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadCsv } from "./menu-engineering-csv";
import { todayJakarta } from "@/lib/tz";

type SortKey = "spend" | "points" | "updated";

const LIMIT_OPTIONS = [10, 25, 50, 100];

export function TopCustomersView() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<SortKey>("spend");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await topCustomers(limit);
      if (cancelled) return;
      if (isOk(res)) setRows(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "spend") {
      copy.sort((a, b) => b.totalSpent - a.totalSpent);
    } else if (sort === "points") {
      copy.sort((a, b) => b.totalPoints - a.totalPoints);
    } else {
      copy.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    return copy;
  }, [rows, sort]);

  const totals = useMemo(
    () => ({
      spend: rows.reduce((s, c) => s + c.totalSpent, 0),
      points: rows.reduce((s, c) => s + c.totalPoints, 0),
    }),
    [rows],
  );

  function onExportCsv() {
    if (sorted.length === 0) return;
    const data = sorted.map((c, idx) => ({
      Rank: idx + 1,
      Nama: c.name,
      "No HP": c.phone,
      "Saldo Poin": c.totalPoints,
      "Lifetime Spend (Rp)": c.totalSpent,
      "Diupdate": new Date(c.updatedAt).toISOString().slice(0, 10),
    }));
    const csv = Papa.unparse(data, { newline: "\n" });
    const today = todayJakarta();
    downloadCsv(`top-member-${today}.csv`, csv);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Top Member
          </h2>
          <p className="text-xs text-neutral-500">
            {rows.length} member · total spend {formatRupiah(totals.spend)} ·{" "}
            {totals.points.toLocaleString("id-ID")} poin
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Select
              label="Limit"
              value={String(limit)}
              onValueChange={(v) => setLimit(parseInt(v, 10))}
              options={LIMIT_OPTIONS.map((n) => ({
                value: String(n),
                label: `Top ${n}`,
              }))}
            />
          </div>
          <Button
            variant="outline"
            onClick={onExportCsv}
            disabled={sorted.length === 0 || loading}
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Peringkat Member</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat top member">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center">
              <Heart
                className="mx-auto size-10 text-neutral-300"
                aria-hidden
              />
              <p className="mt-3 text-sm font-medium text-neutral-700">
                Belum ada member.
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Member auto-terdaftar saat kasir input nomor HP di POS.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-left font-medium">No HP</th>
                    <SortableHeader
                      label="Poin"
                      thisKey="points"
                      activeKey={sort}
                      onClick={() => setSort("points")}
                    />
                    <SortableHeader
                      label="Lifetime Spend"
                      thisKey="spend"
                      activeKey={sort}
                      onClick={() => setSort("spend")}
                    />
                    <SortableHeader
                      label="Diupdate"
                      thisKey="updated"
                      activeKey={sort}
                      onClick={() => setSort("updated")}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sorted.map((c, idx) => (
                    <tr key={c.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                        {idx + 1}.
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {c.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                        {c.phone}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant="success">{c.totalPoints}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatRupiah(c.totalSpent)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-neutral-500">
                        {new Date(c.updatedAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableHeader({
  label,
  thisKey,
  activeKey,
  onClick,
}: {
  label: string;
  thisKey: SortKey;
  activeKey: SortKey;
  onClick: () => void;
}) {
  const active = thisKey === activeKey;
  return (
    <th className="px-4 py-2 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-neutral-900",
          active ? "text-mahakan-green-900" : "text-neutral-500",
        )}
      >
        {label}
        {active ? (
          <ArrowDown className="size-3" aria-hidden />
        ) : (
          <ArrowUp className="size-3 opacity-30" aria-hidden />
        )}
      </button>
    </th>
  );
}
