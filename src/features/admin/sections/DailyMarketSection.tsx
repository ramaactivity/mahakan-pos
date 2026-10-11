"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bike,
  FileText,
  Plus,
  ShoppingBasket,
  Undo2,
  Wallet,
} from "lucide-react";
import { Badge, Button, Input, Modal, Skeleton, toast } from "@/components/ui";
import {
  getDailyMarketSummary,
  isOk,
  listDailyMarketCourierPurchases,
  listDailyMarketEntries,
  reverseDailyMarketEntry,
  type DailyMarketEntryRow,
  type DailyMarketPurchaseRow,
} from "@/features/daily-market";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DailyMarketEntryModal } from "./daily-market/DailyMarketEntryModal";

/**
 * Sesi AE-242 — Belanja Daily Market.
 *
 * Saldo yang tampil di sini dihitung dari catatan modul ini, dan angkanya
 * HARUS sama dengan saldo akun "1103 Saldo Kurir Daily Market" di Buku Kas.
 * Kalau suatu saat beda, yang bermasalah jurnalnya — bukan layar ini.
 */
export function DailyMarketSection({ viewerRole }: { viewerRole: Role }) {
  const qc = useQueryClient();
  const canWrite = hasPermission(viewerRole, "expense.create");
  const canReverse = hasPermission(viewerRole, "expense.delete");
  const [modal, setModal] = useState<"topup" | "spend" | null>(null);
  const [reversing, setReversing] = useState<DailyMarketEntryRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["daily-market", "summary"],
    queryFn: async () => {
      const r = await getDailyMarketSummary();
      if (!isOk(r)) throw new Error(r.error.message);
      return r.data;
    },
  });
  const entriesQ = useQuery({
    queryKey: ["daily-market", "entries"],
    queryFn: async () => {
      const r = await listDailyMarketEntries({ limit: 300 });
      if (!isOk(r)) throw new Error(r.error.message);
      return r.data;
    },
  });

  /* Sesi AE-257 — nota Purchasing yang dibayar dari saldo kurir. */
  const purchasesQ = useQuery({
    queryKey: ["daily-market", "courier-purchases"],
    queryFn: async () => {
      const r = await listDailyMarketCourierPurchases();
      if (!isOk(r)) throw new Error(r.error.message);
      return r.data;
    },
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["daily-market"] });
    void qc.invalidateQueries({ queryKey: ["cash-book"] });
  }

  async function onReverse() {
    if (!reversing) return;
    setBusy(true);
    const r = await reverseDailyMarketEntry({ id: reversing.id, reason });
    setBusy(false);
    if (!isOk(r)) {
      toast.error(r.error.message);
      return;
    }
    toast.success("Catatan dibatalkan, jurnalnya ikut dibalik");
    setReversing(null);
    setReason("");
    refresh();
  }

  const s = summaryQ.data;
  /* Satu daftar urut tanggal: catatan modul ini + nota Purchasing ber-Saldo
   * Kurir. Tanpa nota itu buku kurir terbaca bolong — saldo turun tanpa ada
   * baris yang menjelaskannya. */
  const rows: Array<
    | { type: "entry"; date: string; e: DailyMarketEntryRow }
    | { type: "purchase"; date: string; p: DailyMarketPurchaseRow }
  > = [
    ...(entriesQ.data ?? []).map((e) => ({
      type: "entry" as const,
      date: e.entryDate,
      e,
    })),
    ...(purchasesQ.data ?? []).map((p) => ({
      type: "purchase" as const,
      date: p.purchaseDate,
      p,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Bike className="size-6" aria-hidden /> Belanja Daily Market
          </h1>
          <p className="max-w-3xl text-sm text-neutral-700">
            Uang yang ditransfer ke kurir untuk belanja pasar. Setiap top up
            langsung mengurangi saldo rekening asal, dan setiap belanja
            mengurangi saldo kurir. Semuanya ikut muncul di Buku Kas sebagai
            buku <strong>Saldo Kurir Daily Market</strong>.
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setModal("topup")}>
              <ArrowUpRight className="size-4" aria-hidden /> Top Up Kurir
            </Button>
            <Button onClick={() => setModal("spend")}>
              <Plus className="size-4" aria-hidden /> Catat Belanja
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          icon={<Wallet className="size-5" aria-hidden />}
          label="Sisa Saldo Kurir"
          value={s ? formatRupiah(s.balance) : null}
          hint="Top up − belanja"
          tone={s && s.balance <= 0 ? "warn" : "good"}
        />
        <StatCard
          icon={<ArrowUpRight className="size-5" aria-hidden />}
          label="Total Top Up"
          value={s ? formatRupiah(s.totalTopup) : null}
          hint="Uang yang sudah ditransfer"
        />
        <StatCard
          icon={<ShoppingBasket className="size-5" aria-hidden />}
          label="Total Belanja"
          value={s ? formatRupiah(s.totalSpend) : null}
          hint={
            s
              ? s.purchaseSpend > 0
                ? `${s.entryCount} catatan · termasuk nota Pembelian ${formatRupiah(s.purchaseSpend)}`
                : `${s.entryCount} catatan`
              : undefined
          }
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        {entriesQ.isLoading || purchasesQ.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-600">
            Belum ada catatan. Mulai dengan <strong>Top Up Kurir</strong> saat
            uang ditransfer, lalu <strong>Catat Belanja</strong> setiap kurir
            belanja.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-left">Tanggal</th>
                <th className="px-3 py-2 text-left">Jenis</th>
                <th className="px-3 py-2 text-left">Kurir</th>
                <th className="px-3 py-2 text-left">Keterangan</th>
                <th className="px-3 py-2 text-right">Nominal</th>
                <th className="px-3 py-2 text-left">Sumber / Kategori</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.type === "purchase" ? (
                  <tr key={`p-${row.p.id}`} className="border-t border-neutral-100">
                    <td className="whitespace-nowrap px-3 py-2">{row.p.purchaseDate}</td>
                    <td className="px-3 py-2">
                      <Badge variant="neutral">
                        <FileText className="size-3" aria-hidden /> Nota Pembelian
                      </Badge>
                    </td>
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2">
                      {row.p.label}
                      {row.p.itemsPreview ? (
                        <span className="ml-1 text-xs text-neutral-500">
                          · {row.p.itemsPreview}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-danger-500">
                      − {formatRupiah(row.p.totalAmount)}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      Dicatat di Pembelian
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                ) : (
                <tr
                  key={row.e.id}
                  className={cn(
                    "border-t border-neutral-100",
                    row.e.status === "reversed" && "bg-neutral-50 text-neutral-400",
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2">{row.e.entryDate}</td>
                  <td className="px-3 py-2">
                    {row.e.kind === "topup" ? (
                      <Badge variant="info">
                        <ArrowUpRight className="size-3" aria-hidden /> Top Up
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <ArrowDownLeft className="size-3" aria-hidden /> Belanja
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.e.courierName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.e.description}
                    {row.e.items.length > 0 ? (
                      <span className="ml-1 text-xs text-neutral-500">
                        ·{" "}
                        {row.e.items
                          .map(
                            (i) =>
                              `${i.name} ${i.qty.toLocaleString("id-ID")} ${i.unit}`,
                          )
                          .join(", ")}
                        {/* Di mode periodic stok memang tidak digerakkan —
                            dikatakan terang-terangan supaya tidak ada yang
                            mengira angkanya sudah masuk stok. */}
                        {row.e.items.some((i) => i.stockSkipped) ? (
                          <span className="italic"> (stok dari opname)</span>
                        ) : null}
                      </span>
                    ) : null}
                    {row.e.status === "reversed" ? (
                      <span className="ml-2 text-xs italic">
                        (dibatalkan: {row.e.reversalReason})
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right font-mono",
                      row.e.status === "posted" &&
                        (row.e.kind === "topup"
                          ? "text-mahakan-green-900"
                          : "text-danger-500"),
                    )}
                  >
                    {row.e.kind === "topup" ? "+" : "−"} {formatRupiah(row.e.amount)}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {row.e.bankLabel ?? row.e.categoryName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canReverse && row.e.status === "posted" ? (
                      <button
                        type="button"
                        onClick={() => setReversing(row.e)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-danger-500 hover:underline"
                      >
                        <Undo2 className="size-3.5" aria-hidden /> Batalkan
                      </button>
                    ) : null}
                  </td>
                </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={reversing !== null}
        onClose={() => {
          setReversing(null);
          setReason("");
        }}
        size="sm"
        title={
          reversing
            ? `Batalkan ${reversing.kind === "topup" ? "top up" : "belanja"} ${formatRupiah(reversing.amount)}?`
            : undefined
        }
        description="Jurnalnya dibalik dan saldo kurir ikut menyesuaikan."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setReversing(null);
                setReason("");
              }}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void onReverse()}
            >
              Batalkan Catatan
            </Button>
          </div>
        }
      >
        <Input
          label="Alasan"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="mis. salah nominal"
          autoFocus
        />
      </Modal>

      <DailyMarketEntryModal
        kind={modal}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          refresh();
        }}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4",
        tone === "warn"
          ? "border-warning-500/40 bg-warning-100/40"
          : "border-neutral-200",
      )}
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {icon} {label}
      </p>
      {value == null ? (
        <Skeleton className="mt-2 h-8 w-32" />
      ) : (
        <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
