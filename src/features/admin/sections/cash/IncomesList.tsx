"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DateRangePicker,
  Skeleton,
} from "@/components/ui";
import { IncomeFormModal } from "./IncomeFormModal";
import { isOk, listIncomes, type Income } from "@/features/cash";
import { formatRupiah } from "@/lib/format";

interface IncomesListProps {
  createdBy: string;
}

export function IncomesList({ createdBy }: IncomesListProps) {
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await listIncomes({ from, to, limit: 200 });
      if (cancelled) return;
      if (isOk(res)) setIncomes(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, from, to]);

  const total = incomes.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Pemasukan Non-POS ({incomes.length}) ·{" "}
            <span className="font-mono">{formatRupiah(total)}</span>
          </h2>
          <p className="text-xs text-neutral-500">
            Pemasukan dari luar transaksi POS (sewa ruang, titip jual, dll).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden /> Tambah Pemasukan
        </Button>
      </header>

      <Card>
        <CardHeader>
          <DateRangePicker
            label="Periode"
            value={{ from, to }}
            onChange={(v) => {
              setFrom(v.from ?? monthStart);
              setTo(v.to ?? today);
            }}
          />
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat pemasukan">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : incomes.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada pemasukan di range ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tanggal</th>
                    <th className="px-4 py-2 text-left font-medium">Deskripsi</th>
                    <th className="px-4 py-2 text-left font-medium">Metode</th>
                    <th className="px-4 py-2 text-right font-medium">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {incomes.map((i) => (
                    <tr key={i.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        {i.incomeDate}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {i.description}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700 capitalize">
                        {i.paymentMethod}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-success-500">
                        +{formatRupiah(i.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-neutral-200 bg-neutral-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-right text-xs font-medium text-neutral-500">
                      TOTAL
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-neutral-900">
                      {formatRupiah(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <IncomeFormModal
        open={createOpen}
        createdBy={createdBy}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
