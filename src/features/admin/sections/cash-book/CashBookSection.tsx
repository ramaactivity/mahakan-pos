"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  HelpCircle,
  Plus,
  Search,
} from "lucide-react";
import { Button, DateRangePicker, Skeleton, toast } from "@/components/ui";
import { getCashBook } from "@/features/accounting/cash-book-actions";
import type { CashBook, CashBookLine } from "@/features/accounting/cash-book-pure";
import { formatRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { StyledSheet } from "@/lib/xlsx-styled";
import type { AdminSection } from "../../components/AdminLeftNav";
import { ExportWorkbookButton } from "../ExportWorkbookButton";
import { downloadCsvForExcel } from "../reports/report-export";
import { buildCashBookSheet, cashBookCsvRows, cashBookTitle } from "./cash-book-export";

/**
 * Sesi AE-239 — Buku Kas: catatan uang masuk & keluar per kas/rekening,
 * pengganti sheet "BUKU KAS" yang dulu diisi manual. Isinya otomatis dari
 * jurnal; layar ini hanya membaca. Mencatat uang keluar/masuk baru tetap
 * lewat menu Kas (tombol di kanan atas).
 */

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
/** "1110 Bank BCA" → "Bank BCA"; nama akun sistem kadang panjang. */
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

type Flow = "all" | "in" | "out";

export function CashBookSection({ onNavigate }: { onNavigate?: (s: AdminSection) => void }) {
  const thisMonth = todayJakarta().slice(0, 7);
  /** undefined = belum dipilih → server memilih buku pertama (Kas laci). null = semua. */
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [range, setRange] = useState(() => monthRange(thisMonth));
  const [flow, setFlow] = useState<Flow>("all");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const ym = range.from.slice(0, 7);
  const isWholeMonth =
    range.from === monthRange(ym).from && range.to === monthRange(ym).to;

  const query = useQuery({
    queryKey: ["cash-book", accountId ?? "default", range.from, range.to],
    queryFn: async () => {
      const res = await getCashBook({ accountId, from: range.from, to: range.to });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60_000,
  });
  const book = query.data;
  const selectedId = book ? book.accountId : accountId;

  const visible = useMemo(() => {
    if (!book) return [];
    const q = search.trim().toLowerCase();
    return book.lines.filter((l) => {
      if (flow === "in" && l.masuk === 0) return false;
      if (flow === "out" && l.keluar === 0) return false;
      if (!q) return true;
      return (
        l.description.toLowerCase().includes(q) ||
        l.entryNumber.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.counterparts.some((c) => c.code.includes(q) || c.name.toLowerCase().includes(q))
      );
    });
  }, [book, flow, search]);
  const filtering = flow !== "all" || search.trim() !== "";

  async function downloadExcel() {
    if (!book) throw new Error("EMPTY");
    const { downloadStyledXlsx } = await import("@/lib/xlsx-styled");
    await downloadStyledXlsx(fileBase(book), [buildCashBookSheet(book)] as unknown as Array<StyledSheet<never>>);
  }
  function downloadCsv() {
    if (!book) return;
    downloadCsvForExcel(fileBase(book), cashBookCsvRows(book));
    toast.success("Berkas CSV diunduh");
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <BookText className="size-6" aria-hidden /> Buku Kas
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Catatan uang masuk dan keluar per kas atau rekening. Terisi otomatis dari kasir, pembelian,
            gaji, setoran, dan input di menu Kas — tidak perlu diketik ulang.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onNavigate ? (
            <Button variant="outline" size="sm" onClick={() => onNavigate("cash")}>
              <Plus className="size-4" /> Catat uang masuk / keluar
            </Button>
          ) : null}
          <ExportWorkbookButton build={downloadExcel} label="Excel" />
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!book}>
            <FileText className="size-4" /> CSV
          </Button>
        </div>
      </header>

      {/* Pilih buku */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pilih buku kas">
        {(book?.accounts ?? []).map((a) => (
          <BookChip key={a.id} active={selectedId === a.id} onClick={() => setAccountId(a.id)}>
            {shortName(a.name)}
          </BookChip>
        ))}
        {book && book.accounts.length > 1 ? (
          <BookChip active={selectedId === null} onClick={() => setAccountId(null)}>
            Semua Kas &amp; Bank
          </BookChip>
        ) : null}
      </div>

      {/* Periode */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-neutral-200 bg-white">
          <button
            type="button"
            aria-label="Bulan sebelumnya"
            onClick={() => setRange(monthRange(shiftMonth(ym, -1)))}
            className="flex min-h-10 items-center px-2.5 text-neutral-600 hover:bg-neutral-50"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-36 px-2 text-center text-sm font-semibold text-neutral-900">
            {isWholeMonth ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : `${dmy(range.from)} – ${dmy(range.to)}`}
          </span>
          <button
            type="button"
            aria-label="Bulan berikutnya"
            onClick={() => setRange(monthRange(shiftMonth(ym, 1)))}
            disabled={isWholeMonth && ym >= thisMonth}
            className="flex min-h-10 items-center px-2.5 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="w-60">
          <DateRangePicker
            size="sm"
            ariaLabel="Pilih rentang tanggal sendiri"
            value={range}
            onChange={(v) => {
              if (v.from && v.to) setRange({ from: v.from, to: v.to });
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="ml-auto flex items-center gap-1 text-sm font-medium text-mahakan-green-700"
        >
          <HelpCircle className="size-4" /> Cara membaca
        </button>
      </div>

      {showHelp ? <HelpBox /> : null}

      {query.isError ? (
        <p className="rounded-md border border-danger-100 bg-danger-100/40 p-3 text-sm text-danger-500">
          {query.error instanceof Error ? query.error.message : "Gagal memuat buku kas"}
        </p>
      ) : !book ? (
        <div className="space-y-3" role="status" aria-label="Memuat buku kas">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <>
          <Summary book={book} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari uraian, ref, atau akun…"
                className="h-10 w-64 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700"
              />
            </div>
            <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5" role="group" aria-label="Saring arah uang">
              {(
                [
                  ["all", "Semua"],
                  ["in", "Uang masuk"],
                  ["out", "Uang keluar"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={flow === k}
                  onClick={() => setFlow(k)}
                  className={cn(
                    "min-h-9 rounded-md px-3 text-sm font-medium",
                    flow === k ? "bg-mahakan-green-700 text-white" : "text-neutral-600 hover:bg-neutral-100",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-500">
              {visible.length} dari {book.lines.length} catatan
              {filtering ? " · saldo tetap dihitung dari semua catatan" : ""}
            </span>
          </div>

          <LedgerTable
            book={book}
            lines={visible}
            filtering={filtering}
            openRow={openRow}
            onToggle={(id) => setOpenRow((cur) => (cur === id ? null : id))}
          />
        </>
      )}
    </div>
  );
}

function fileBase(book: CashBook) {
  const name = cashBookTitle(book).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `buku-kas-${name}-${book.from}-sd-${book.to}`;
}

function BookChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full px-3.5 text-sm font-medium transition-colors",
        active ? "bg-mahakan-green-700 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
      )}
    >
      {children}
    </button>
  );
}

function Summary({ book }: { book: CashBook }) {
  const net = book.totalIn - book.totalOut;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Saldo awal" hint={`per ${dmy(book.from)}`} value={formatRupiah(book.openingBalance)} />
      <Stat
        label="Uang masuk"
        hint={`${book.lines.filter((l) => l.masuk > 0).length} catatan`}
        value={`+ ${formatRupiah(book.totalIn)}`}
        tone="in"
        icon={<ArrowDownLeft className="size-4" />}
      />
      <Stat
        label="Uang keluar"
        hint={`${book.lines.filter((l) => l.keluar > 0).length} catatan`}
        value={`− ${formatRupiah(book.totalOut)}`}
        tone="out"
        icon={<ArrowUpRight className="size-4" />}
      />
      <Stat
        label="Saldo akhir"
        hint={`per ${dmy(book.to)} · ${net >= 0 ? "naik" : "turun"} ${formatRupiah(Math.abs(net))}`}
        value={formatRupiah(book.closingBalance)}
        strong
        warn={
          book.closingBalance < 0
            ? "Saldo minus: biasanya ada uang masuk yang belum tercatat, atau transaksi tercatat di rekening yang salah."
            : undefined
        }
      />
    </div>
  );
}

function Stat({
  label,
  hint,
  value,
  tone,
  icon,
  strong,
  warn,
}: {
  label: string;
  hint: string;
  value: string;
  tone?: "in" | "out";
  icon?: React.ReactNode;
  strong?: boolean;
  warn?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-4", strong ? "border-mahakan-green-700/40" : "border-neutral-200")}>
      <p
        className={cn(
          "flex items-center gap-1 text-xs font-semibold uppercase tracking-wider",
          tone === "in" ? "text-mahakan-green-700" : tone === "out" ? "text-danger-500" : "text-neutral-500",
        )}
      >
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-xl font-bold break-words",
          tone === "in" ? "text-mahakan-green-700" : tone === "out" ? "text-danger-500" : "text-neutral-900",
          warn && "text-danger-500",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
      {warn ? (
        <p className="mt-2 flex gap-1 text-xs text-danger-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {warn}
        </p>
      ) : null}
    </div>
  );
}

function LedgerTable({
  book,
  lines,
  filtering,
  openRow,
  onToggle,
}: {
  book: CashBook;
  lines: CashBookLine[];
  filtering: boolean;
  openRow: string | null;
  onToggle: (id: string) => void;
}) {
  const all = book.accountId === null;
  const colCount = 8;
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
          <tr className="border-b border-neutral-200">
            <th className="px-3 py-2.5 text-left font-semibold">Tanggal</th>
            <th className="px-3 py-2.5 text-left font-semibold">Ref</th>
            <th className="px-3 py-2.5 text-left font-semibold">No. Akun</th>
            <th className="px-3 py-2.5 text-left font-semibold">Uraian</th>
            <th className="px-3 py-2.5 text-right font-semibold text-mahakan-green-700">Masuk (D)</th>
            <th className="px-3 py-2.5 text-right font-semibold text-danger-500">Keluar (K)</th>
            <th className="px-3 py-2.5 text-right font-semibold">Saldo</th>
            <th className="px-3 py-2.5 text-left font-semibold">Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {!filtering ? (
            <tr className="border-b border-neutral-100 bg-mahakan-green-50/50">
              <td className="px-3 py-2 text-neutral-600">{dmy(book.from)}</td>
              <td />
              <td />
              <td className="px-3 py-2 font-semibold italic text-neutral-800">Saldo Awal</td>
              <td />
              <td />
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatRupiah(book.openingBalance)}</td>
              <td />
            </tr>
          ) : null}
          {lines.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-10 text-center text-sm text-neutral-500">
                {filtering ? "Tidak ada catatan yang cocok." : "Belum ada uang masuk atau keluar di periode ini."}
              </td>
            </tr>
          ) : (
            lines.map((l, i) => {
              const key = `${l.entryId}-${l.cashAccount}`;
              const newDay = i === 0 || lines[i - 1]!.entryDate !== l.entryDate;
              const open = openRow === key;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => onToggle(key)}
                    className={cn(
                      "cursor-pointer align-top hover:bg-neutral-50",
                      newDay ? "border-t border-neutral-200" : "border-t border-neutral-100",
                      open && "bg-neutral-50",
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-700">{newDay ? dayLabel(l.entryDate) : ""}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-500">{l.entryNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-700" title={l.counterparts.map((c) => `${c.code} ${c.name}`).join("\n")}>
                      {l.counterparts.map((c) => c.code).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-900">
                      <span className="flex items-start gap-1">
                        {open ? <ChevronUp className="mt-0.5 size-3.5 shrink-0 text-neutral-400" /> : <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />}
                        <span>
                          {l.description}
                          {all ? <span className="block text-xs text-neutral-500">{shortName(l.cashAccount)}</span> : null}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-mahakan-green-700">
                      {l.masuk ? formatRupiah(l.masuk) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-danger-500">
                      {l.keluar ? formatRupiah(l.keluar) : ""}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-mono font-medium", l.saldo < 0 ? "text-danger-500" : "text-neutral-900")}>
                      {formatRupiah(l.saldo)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                        {l.isTransfer ? "Pindah antar kas/bank" : l.source}
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-neutral-50">
                      <td colSpan={colCount} className="px-3 pb-3 pt-0">
                        <EntryDetail line={l} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
        {!filtering && lines.length > 0 ? (
          <tfoot>
            <tr className="border-t-2 border-mahakan-green-700/40 bg-mahakan-green-50/50 font-semibold">
              <td colSpan={4} className="px-3 py-2.5 text-neutral-900">
                Total periode ini
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-mahakan-green-700">{formatRupiah(book.totalIn)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-danger-500">{formatRupiah(book.totalOut)}</td>
              <td className={cn("px-3 py-2.5 text-right font-mono", book.closingBalance < 0 ? "text-danger-500" : "text-neutral-900")}>
                {formatRupiah(book.closingBalance)}
              </td>
              <td className="px-3 py-2.5 text-xs font-normal text-neutral-500">saldo akhir</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function EntryDetail({ line }: { line: CashBookLine }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="mb-2 text-xs text-neutral-500">
        Jurnal <span className="font-mono">{line.entryNumber}</span> · {line.source}. Setiap catatan uang selalu punya
        pasangan: kalau uang masuk, ada akun yang menjadi sumbernya; kalau keluar, ada akun tujuannya.
      </p>
      <table className="w-full max-w-2xl text-xs">
        <thead className="text-neutral-500">
          <tr>
            <th className="py-1 text-left font-medium">Akun</th>
            <th className="py-1 text-right font-medium">Debit</th>
            <th className="py-1 text-right font-medium">Kredit</th>
          </tr>
        </thead>
        <tbody>
          {line.entryLines.map((e, i) => (
            <tr key={`${e.code}-${i}`} className="border-t border-neutral-100">
              <td className="py-1 text-neutral-800">
                <span className="font-mono text-neutral-500">{e.code}</span> {e.name}
              </td>
              <td className="py-1 text-right font-mono">{e.debit ? formatRupiah(e.debit) : ""}</td>
              <td className="py-1 text-right font-mono">{e.credit ? formatRupiah(e.credit) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HelpBox() {
  return (
    <div className="rounded-xl border border-mahakan-green-700/20 bg-mahakan-green-50/60 p-4 text-sm text-neutral-700">
      <p className="mb-2 font-semibold text-neutral-900">Cara membaca Buku Kas</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Masuk (D)</b> = uang bertambah, <b>Keluar (K)</b> = uang berkurang. D dan K adalah singkatan Debit dan Kredit.
        </li>
        <li>
          <b>Saldo</b> = sisa uang setelah catatan di baris itu. Baris paling atas adalah saldo awal periode.
        </li>
        <li>
          <b>No. Akun</b> = akun pasangannya, misalnya 4102 Penjualan Minuman untuk uang masuk dari kasir. Klik baris untuk
          melihat rinciannya.
        </li>
        <li>
          Semua catatan terisi otomatis. Kalau ada uang keluar/masuk yang belum tercatat, catat lewat tombol{" "}
          <b>Catat uang masuk / keluar</b> (menu Kas).
        </li>
      </ul>
    </div>
  );
}
