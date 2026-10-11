"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bike,
  ChevronDown,
  FileText,
  Paperclip,
  Plus,
  ShoppingBasket,
  Undo2,
  Wallet,
} from "lucide-react";
import { Button, Input, Modal, Skeleton, toast } from "@/components/ui";
import {
  getDailyMarketSummary,
  isOk,
  listDailyMarketCourierPurchases,
  listDailyMarketEntries,
  reverseDailyMarketEntry,
  updateDailyMarketReceipts,
  type DailyMarketEntryRow,
  type DailyMarketPurchaseRow,
} from "@/features/daily-market";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PurchaseReceiptsField,
  type PurchaseReceipt,
} from "@/features/admin/sections/inventory/purchases/PurchaseReceiptsField";
import { DailyMarketEntryModal } from "./daily-market/DailyMarketEntryModal";

/**
 * Sesi AE-242 — Belanja Daily Market.
 *
 * Saldo yang tampil di sini dihitung dari catatan modul ini, dan angkanya
 * HARUS sama dengan saldo akun "1103 Saldo Kurir Daily Market" di Buku Kas.
 * Kalau suatu saat beda, yang bermasalah jurnalnya — bukan layar ini.
 *
 * Sesi AE-258 — dibaca seperti mutasi rekening: dikelompokkan per tanggal,
 * tiap baris memperlihatkan saldo kurir SETELAH transaksi itu, supaya sisa
 * uang di tangan kurir bisa dicocokkan hari per hari.
 */

type Row =
  | { type: "entry"; date: string; at: string; e: DailyMarketEntryRow }
  | { type: "purchase"; date: string; at: string; p: DailyMarketPurchaseRow };

type Filter = "all" | "topup" | "spend" | "purchase";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "topup", label: "Top Up" },
  { value: "spend", label: "Belanja" },
  { value: "purchase", label: "Nota Pembelian" },
];

/** "2026-10-10" → "Sabtu, 10 Okt 2026" tanpa geser zona waktu. */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

function rowKey(r: Row): string {
  return r.type === "entry" ? r.e.id : `p-${r.p.id}`;
}

function isPosted(r: Row): boolean {
  return r.type === "purchase" || r.e.status === "posted";
}

/** + masuk ke saldo kurir, − keluar. */
function deltaOf(r: Row): number {
  if (r.type === "purchase") return -r.p.totalAmount;
  return r.e.kind === "topup" ? r.e.amount : -r.e.amount;
}

function receiptsOf(r: Row): string[] {
  if (r.type === "purchase") return r.p.receiptUrls;
  return r.e.receiptImageUrls?.length
    ? r.e.receiptImageUrls
    : r.e.receiptImageUrl
      ? [r.e.receiptImageUrl]
      : [];
}

export function DailyMarketSection({ viewerRole }: { viewerRole: Role }) {
  const qc = useQueryClient();
  const canWrite = hasPermission(viewerRole, "expense.create");
  const canReverse = hasPermission(viewerRole, "expense.delete");
  const [modal, setModal] = useState<"topup" | "spend" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showReversed, setShowReversed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reversing, setReversing] = useState<DailyMarketEntryRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notaFor, setNotaFor] = useState<Row | null>(null);

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

  /* Satu daftar urut terbaru: catatan modul ini + nota Purchasing ber-Saldo
   * Kurir. Saldo per baris dihitung MUNDUR dari saldo sekarang (bukan maju
   * dari nol), jadi tetap benar walau daftar lama terpotong batas tampil. */
  const { groups, saldoAfter } = useMemo(() => {
    const all: Row[] = [
      ...(entriesQ.data ?? []).map((e) => ({
        type: "entry" as const,
        date: e.entryDate,
        at: new Date(e.createdAt).toISOString(),
        e,
      })),
      ...(purchasesQ.data ?? []).map((p) => ({
        type: "purchase" as const,
        date: p.purchaseDate,
        at: p.createdAt,
        p,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));

    const saldo = new Map<string, number>();
    let cur = s?.balance ?? 0;
    for (const r of all) {
      if (!isPosted(r)) continue;
      saldo.set(rowKey(r), cur);
      cur -= deltaOf(r);
    }

    const visible = all.filter((r) => {
      if (!showReversed && !isPosted(r)) return false;
      if (filter === "all") return true;
      if (filter === "purchase") return r.type === "purchase";
      return r.type === "entry" && r.e.kind === filter;
    });
    const byDate = new Map<string, Row[]>();
    for (const r of visible) {
      const list = byDate.get(r.date) ?? [];
      list.push(r);
      byDate.set(r.date, list);
    }
    return { groups: [...byDate.entries()], saldoAfter: saldo };
  }, [entriesQ.data, purchasesQ.data, s?.balance, filter, showReversed]);

  const reversedCount = (entriesQ.data ?? []).filter(
    (e) => e.status === "reversed",
  ).length;
  const lastCourier =
    (entriesQ.data ?? []).find((e) => e.courierName)?.courierName ?? null;
  const loading = entriesQ.isLoading || purchasesQ.isLoading;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Bike className="size-6" aria-hidden /> Belanja Daily Market
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Buku uang muka kurir. Top up = transfer dari rekening outlet ke
            kurir; belanja = uang kurir yang dipakai ke pasar.
          </p>
        </div>
        {canWrite ? (
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 rounded-full sm:flex-none"
              onClick={() => setModal("topup")}
            >
              <ArrowUpRight className="size-4" aria-hidden /> Top Up
            </Button>
            <Button
              className="flex-1 rounded-full sm:flex-none"
              onClick={() => setModal("spend")}
            >
              <Plus className="size-4" aria-hidden /> Catat Belanja
            </Button>
          </div>
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
        <div
          className={cn(
            "col-span-2 rounded-2xl p-5 shadow-sm md:col-span-1",
            s && s.balance < 0
              ? "bg-danger-100"
              : "bg-mahakan-green-50 ring-1 ring-mahakan-green-100",
          )}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <Wallet className="size-4" aria-hidden /> Sisa saldo di kurir
          </p>
          {s ? (
            <p
              className={cn(
                "mt-1 text-3xl font-bold tabular-nums",
                s.balance < 0 ? "text-danger-600" : "text-mahakan-green-900",
              )}
            >
              {formatRupiah(s.balance)}
            </p>
          ) : (
            <Skeleton className="mt-2 h-9 w-40" />
          )}
          <p className="mt-1 text-xs text-neutral-600">
            Harus sama dengan uang yang sedang dipegang kurir.
          </p>
        </div>
        <StatCard
          icon={<ArrowUpRight className="size-4" aria-hidden />}
          label="Total top up"
          value={s ? formatRupiah(s.totalTopup) : null}
          hint="Uang yang sudah ditransfer"
        />
        <StatCard
          icon={<ShoppingBasket className="size-4" aria-hidden />}
          label="Total belanja"
          value={s ? formatRupiah(s.totalSpend) : null}
          hint={
            s && s.purchaseSpend > 0
              ? `Termasuk nota Pembelian ${formatRupiah(s.purchaseSpend)}`
              : "Dibayar dari saldo kurir"
          }
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={cn(
              "min-h-9 rounded-full px-4 text-sm font-medium transition-colors",
              filter === f.value
                ? "bg-mahakan-green-700 text-white"
                : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50",
            )}
          >
            {f.label}
          </button>
        ))}
        {reversedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowReversed((v) => !v)}
            aria-pressed={showReversed}
            className="ml-auto min-h-9 rounded-full px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {showReversed ? "Sembunyikan" : "Tampilkan"} {reversedCount} yang
            dibatalkan
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-neutral-200">
          <ShoppingBasket className="mx-auto size-8 text-neutral-400" aria-hidden />
          <p className="mt-2 text-sm text-neutral-600">
            {filter === "all"
              ? "Belum ada catatan. Mulai dengan Top Up saat uang ditransfer ke kurir."
              : "Tidak ada catatan untuk filter ini."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, rows]) => (
            <section key={date} aria-label={formatDay(date)}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {formatDay(date)}
              </h2>
              <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
                {rows.map((r) => (
                  <LedgerRow
                    key={rowKey(r)}
                    row={r}
                    saldo={saldoAfter.get(rowKey(r)) ?? null}
                    expanded={expanded.has(rowKey(r))}
                    onToggle={() => toggle(rowKey(r))}
                    onNota={() => setNotaFor(r)}
                    onReverse={
                      canReverse && r.type === "entry" && r.e.status === "posted"
                        ? () => setReversing(r.e)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

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

      <NotaModal
        row={notaFor}
        canEdit={canWrite}
        onClose={() => setNotaFor(null)}
        onSaved={() => {
          setNotaFor(null);
          refresh();
        }}
      />

      <DailyMarketEntryModal
        kind={modal}
        defaultCourier={lastCourier}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          refresh();
        }}
      />
    </div>
  );
}

function LedgerRow({
  row,
  saldo,
  expanded,
  onToggle,
  onNota,
  onReverse,
}: {
  row: Row;
  saldo: number | null;
  expanded: boolean;
  onToggle: () => void;
  onNota: () => void;
  onReverse?: () => void;
}) {
  const posted = isPosted(row);
  const delta = deltaOf(row);
  const isIn = delta > 0;
  const receipts = receiptsOf(row);

  let title: string;
  let meta: string;
  let kindLabel: string;
  let items: Array<{ name: string; detail: string; subtotal: number }> = [];
  if (row.type === "purchase") {
    title = row.p.label;
    kindLabel = "Nota Pembelian";
    meta = "Dicatat di menu Pembelian";
    items = row.p.itemsPreview
      ? row.p.itemsPreview.split(", ").map((name) => ({ name, detail: "", subtotal: 0 }))
      : [];
  } else {
    const e = row.e;
    title = e.description;
    kindLabel = e.kind === "topup" ? "Top Up" : "Belanja";
    meta = [e.courierName, e.bankLabel ?? e.categoryName].filter(Boolean).join(" · ");
    items = e.items.map((i) => ({
      name: i.name,
      detail: `${i.qty.toLocaleString("id-ID")} ${i.unit}`,
      subtotal: i.subtotal,
    }));
  }
  const preview = items.slice(0, 3).map((i) => i.name).join(", ");
  const more = items.length - 3;

  return (
    <li className={cn("px-4 py-3", !posted && "bg-neutral-50 opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
            row.type === "purchase"
              ? "bg-info-100 text-info-500"
              : isIn
                ? "bg-mahakan-green-100 text-mahakan-green-700"
                : "bg-warning-100 text-warning-500",
          )}
          aria-hidden
        >
          {row.type === "purchase" ? (
            <FileText className="size-4" />
          ) : isIn ? (
            <ArrowUpRight className="size-4" />
          ) : (
            <ArrowDownLeft className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-900">{title}</p>
              <p className="truncate text-xs text-neutral-500">
                {kindLabel}
                {meta ? ` · ${meta}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  "font-semibold tabular-nums",
                  !posted
                    ? "text-neutral-400 line-through"
                    : isIn
                      ? "text-mahakan-green-700"
                      : "text-neutral-900",
                )}
              >
                {isIn ? "+" : "−"} {formatRupiah(Math.abs(delta))}
              </p>
              {saldo !== null ? (
                <p className="text-xs tabular-nums text-neutral-500">
                  Saldo {formatRupiah(saldo)}
                </p>
              ) : null}
            </div>
          </div>

          {items.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="mt-1.5 flex max-w-full items-center gap-1 text-left text-xs text-neutral-600 hover:text-neutral-900"
            >
              <ChevronDown
                className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
                aria-hidden
              />
              <span className="truncate">
                {items.length} bahan: {preview}
                {more > 0 ? ` +${more} lainnya` : ""}
              </span>
            </button>
          ) : null}
          {expanded && items.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-xl bg-neutral-50 p-2 text-xs">
              {items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3">
                  <span className="text-neutral-800">
                    {i.name}
                    {i.detail ? <span className="text-neutral-500"> · {i.detail}</span> : null}
                  </span>
                  {i.subtotal > 0 ? (
                    <span className="tabular-nums text-neutral-700">
                      {formatRupiah(i.subtotal)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {row.type === "entry" && row.e.status === "reversed" ? (
            <p className="mt-1 text-xs italic text-neutral-500">
              Dibatalkan: {row.e.reversalReason}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {receipts.length > 0 || row.type === "entry" ? (
              <button
                type="button"
                onClick={onNota}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-medium",
                  receipts.length > 0
                    ? "bg-mahakan-green-50 text-mahakan-green-700 hover:bg-mahakan-green-100"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                )}
              >
                <Paperclip className="size-3.5" aria-hidden />
                {receipts.length > 0 ? `${receipts.length} nota` : "Lampirkan nota"}
              </button>
            ) : null}
            {onReverse ? (
              <button
                type="button"
                onClick={onReverse}
                className="inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-danger-500 hover:bg-danger-100"
              >
                <Undo2 className="size-3.5" aria-hidden /> Batalkan
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Lihat / lampirkan foto nota. Nota Pembelian hanya dilihat — diubah dari
 * menu Pembelian supaya tetap satu tempat. */
function NotaModal({
  row,
  canEdit,
  onClose,
  onSaved,
}: {
  row: Row | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<PurchaseReceipt[]>([]);
  const [saving, setSaving] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const editable = canEdit && row?.type === "entry";

  /* Isi ulang setiap kali modal dibuka untuk baris lain. */
  const key = row ? rowKey(row) : null;
  if (key !== openFor) {
    setOpenFor(key);
    setValue(
      row ? receiptsOf(row).map((url, i) => ({ url, name: `Nota ${i + 1}` })) : [],
    );
  }

  async function save() {
    if (row?.type !== "entry") return;
    setSaving(true);
    const r = await updateDailyMarketReceipts({
      id: row.e.id,
      receiptImageUrls: value.map((v) => v.url),
    });
    setSaving(false);
    if (!isOk(r)) {
      toast.error(r.error.message);
      return;
    }
    toast.success("Nota tersimpan");
    onSaved();
  }

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      size="sm"
      title="Nota"
      description={
        row?.type === "purchase"
          ? "Nota ini milik menu Pembelian — ubah dari sana."
          : "Foto nota pasar atau bukti transfer. Tersimpan di Google Drive."
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {editable ? "Batal" : "Tutup"}
          </Button>
          {editable ? (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan Nota"}
            </Button>
          ) : null}
        </div>
      }
    >
      {editable && row?.type === "entry" ? (
        <PurchaseReceiptsField
          value={value}
          onChange={setValue}
          purchaseDate={row.e.entryDate}
          disabled={saving}
          label="Foto nota"
        />
      ) : (
        <ul className="space-y-1.5">
          {value.map((v) => (
            <li key={v.url}>
              <a
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl bg-neutral-50 p-2 text-sm text-mahakan-green-700 hover:underline"
              >
                <FileText className="size-4" aria-hidden /> {v.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-neutral-600">
        {icon} {label}
      </p>
      {value == null ? (
        <Skeleton className="mt-2 h-7 w-32" />
      ) : (
        <p className="mt-1 text-lg font-bold tabular-nums text-neutral-900 sm:text-xl">{value}</p>
      )}
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
