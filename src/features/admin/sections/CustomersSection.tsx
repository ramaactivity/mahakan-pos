"use client";

import { useEffect, useMemo, useState } from "react";
import { Heart, Search, TrendingUp, Wallet } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  Input,
  Skeleton,
} from "@/components/ui";
import {
  customerStats,
  isOk,
  listCustomers,
  type Customer,
} from "@/features/customers";
import { formatRupiah } from "@/lib/format";
import { CustomerDetailModal } from "./customers/CustomerDetailModal";

const PAGE_SIZE = 50;

export function CustomersSection() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<{
    total: number;
    totalPointsOutstanding: number;
    lifetimeSpend: number;
  } | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);

  // Debounce search → re-fetch list.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await listCustomers({
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
      });
      if (cancelled) return;
      if (isOk(res)) {
        setRows(res.data.items);
        setTotal(res.data.total);
      }
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // Stats — fetched once on mount, refreshed when search clears.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await customerStats();
      if (!cancelled && isOk(res)) setStats(res.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const headline = useMemo(() => {
    if (!stats) return null;
    return [
      {
        label: "Total Member",
        value: stats.total.toLocaleString("id-ID"),
        Icon: Heart,
      },
      {
        label: "Poin Beredar",
        value: stats.totalPointsOutstanding.toLocaleString("id-ID"),
        Icon: TrendingUp,
      },
      {
        label: "Lifetime Spend",
        value: formatRupiah(stats.lifetimeSpend),
        Icon: Wallet,
      },
    ];
  }, [stats]);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Member</h1>
        <p className="text-sm text-neutral-500">
          Database loyalty customer. Member otomatis terdaftar saat kasir input
          nomor HP di POS.
        </p>
      </header>

      {headline ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {headline.map((s) => (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-md bg-mahakan-green-100 text-mahakan-green-700">
                  <s.Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-neutral-500">
                    {s.label}
                  </p>
                  <p className="font-mono text-lg font-bold text-neutral-900">
                    {s.value}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="relative max-w-sm">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau nomor HP..."
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows && rows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Heart
                className="mx-auto size-10 text-neutral-300"
                aria-hidden
              />
              <p className="mt-3 text-sm font-medium text-neutral-700">
                {search ? "Tidak ada member yang cocok." : "Belum ada member."}
              </p>
              {!search ? (
                <p className="mt-1 text-xs text-neutral-500">
                  Member auto-terdaftar saat kasir input nomor HP di POS Order
                  Baru.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Nama</th>
                    <th className="px-4 py-2.5 font-medium">No HP</th>
                    <th className="px-4 py-2.5 font-medium text-right">
                      Poin
                    </th>
                    <th className="px-4 py-2.5 font-medium text-right">
                      Lifetime Spend
                    </th>
                    <th className="px-4 py-2.5 font-medium">Diupdate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setDetail(c)}
                      className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 focus-within:bg-neutral-50"
                    >
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        <button
                          type="button"
                          className="text-left hover:text-mahakan-green-900 focus-visible:outline-none focus-visible:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetail(c);
                          }}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-700">
                        {c.phone}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <Badge variant="success">{c.totalPoints}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-neutral-900">
                        {formatRupiah(c.totalSpent)}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-500">
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
              {total > (rows?.length ?? 0) ? (
                <div className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500">
                  Menampilkan {rows?.length}/{total} member. Persempit
                  pencarian untuk melihat lebih spesifik.
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>

      <CustomerDetailModal
        open={detail !== null}
        customer={detail}
        onClose={() => setDetail(null)}
        onUpdated={(next) => {
          setDetail(next);
          setRows((prev) =>
            prev ? prev.map((r) => (r.id === next.id ? next : r)) : prev,
          );
        }}
      />
    </div>
  );
}
