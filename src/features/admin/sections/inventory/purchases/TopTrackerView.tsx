"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DatePicker,
  EmptyCard,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  isOk,
  listTopHistory,
  markPurchasePaid,
  updatePurchasePaymentDate,
  type PaymentMethod,
  type TopHistoryItem,
  type TopHistoryStatus,
  type TopHistorySummary,
} from "@/features/purchases";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "due_soon" | "overdue";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Semua",
  due_soon: "Due ≤ 3 hari",
  overdue: "Lewat jatuh tempo",
};

/* Sesi AE-184 — dimensi STATUS, terpisah dari filter jatuh tempo. Sebelumnya
 * layar ini cuma query pending_payment sehingga hutang yang sudah dibayar
 * hilang total dari catatan. */
type StatusTab = TopHistoryStatus | "all";

const STATUS_LABELS: Record<StatusTab, string> = {
  pending_payment: "Belum Bayar",
  paid: "Sudah Lunas",
  cancelled: "Dibatalkan",
  all: "Semua",
};

const SETTLE_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  other: "Lainnya",
};

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatTanggal(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const PAY_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "Transfer BCA" },
  { value: "transfer_bri", label: "Transfer BRI" },
  { value: "transfer_other", label: "Transfer lain" },
];

export function TopTrackerView() {
  const { session } = useSession();
  const role = session?.user.role;
  const canMarkPaid = role
    ? hasPermission(role, "purchase.mark_paid")
    : false;
  /* Sesi AE-188 — koreksi tanggal pembayaran yang terlanjur salah. Owner saja:
   * ikut memindahkan jurnal yang sudah diposting. */
  const canFixPayDate = role
    ? hasPermission(role, "accounting.journal.post")
    : false;

  const [items, setItems] = useState<TopHistoryItem[]>([]);
  const [summary, setSummary] = useState<TopHistorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [statusTab, setStatusTab] = useState<StatusTab>("pending_payment");

  const [payTarget, setPayTarget] = useState<TopHistoryItem | null>(
    null,
  );
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  /* Sesi AE-188 — tanggal pembayaran (owner request). Ikut ke paid_at,
   * tanggal pengeluaran kas, DAN tanggal jurnal umum. Default hari ini. */
  const [payDate, setPayDate] = useState<string>(() => todayJakartaIso());
  const [paySubmitting, setPaySubmitting] = useState(false);

  /* Koreksi tanggal untuk hutang yang SUDAH lunas. */
  const [fixTarget, setFixTarget] = useState<TopHistoryItem | null>(null);
  const [fixDate, setFixDate] = useState<string>(() => todayJakartaIso());
  const [fixReason, setFixReason] = useState("");
  const [fixSubmitting, setFixSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listTopHistory({ status: statusTab });
      if (cancelled) return;
      if (isOk(res)) {
        setItems(res.data.items);
        setSummary(res.data.summary);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, statusTab]);

  /* Saringan jatuh tempo hanya bermakna untuk hutang yang masih berjalan —
   * untuk yang sudah lunas, "telat sekian hari" tidak relevan lagi. */
  const dueFilterActive = statusTab === "pending_payment";

  const filtered = useMemo(() => {
    if (!dueFilterActive || filter === "all") return items;
    if (filter === "due_soon")
      return items.filter(
        (i) => i.daysToDue !== null && i.daysToDue >= 0 && i.daysToDue <= 3,
      );
    return items.filter((i) => i.daysToDue !== null && i.daysToDue < 0);
  }, [items, filter, dueFilterActive]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function onConfirmPaid() {
    if (!payTarget || paySubmitting) return;
    if (payDate > todayJakartaIso()) {
      toast.error("Tanggal pembayaran tidak boleh di masa depan");
      return;
    }
    setPaySubmitting(true);
    const res = await markPurchasePaid({
      id: payTarget.id,
      paymentMethod: payMethod,
      paymentDate: payDate,
    });
    setPaySubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Lunas dicatat per ${payDate}${res.data.expenseId ? " + entry kas dibuat" : ""}`,
    );
    setPayTarget(null);
    refresh();
  }

  async function onConfirmFixDate() {
    if (!fixTarget || fixSubmitting) return;
    if (fixReason.trim().length < 5) {
      toast.error("Alasan koreksi minimal 5 karakter");
      return;
    }
    setFixSubmitting(true);
    const res = await updatePurchasePaymentDate({
      id: fixTarget.id,
      paymentDate: fixDate,
      reason: fixReason.trim(),
    });
    setFixSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Tanggal pembayaran dipindah ${res.data.previousDate} → ${res.data.paymentDate}` +
        (res.data.journalMoved ? " (jurnal ikut dipindah)" : ""),
    );
    setFixTarget(null);
    setFixReason("");
    refresh();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <Clock className="size-5" aria-hidden /> Hutang Dagang
          </h2>
          <p className="text-xs text-neutral-500">
            Riwayat lengkap pembelian tempo (TOP) — yang belum dibayar maupun
            yang sudah lunas. Tandai lunas otomatis mencatat entry kas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </header>

      {/* Ringkasan dihitung dari SELURUH hutang TOP, bukan cuma tab yang
          sedang dibuka — supaya angka belum-bayar tetap terlihat saat owner
          sedang menelusuri yang sudah lunas. */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          label={`Belum Bayar (${summary?.outstandingCount ?? 0})`}
          value={formatRupiah(summary?.outstandingAmount ?? 0)}
          tone="info"
        />
        <SummaryCard
          label={`Sudah Lunas (${summary?.paidCount ?? 0})`}
          value={formatRupiah(summary?.paidAmount ?? 0)}
          tone="neutral"
        />
        <SummaryCard
          label="Due ≤ 3 hari"
          value={formatRupiah(summary?.dueSoonAmount ?? 0)}
          tone={(summary?.dueSoonAmount ?? 0) > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          label="Lewat jatuh tempo"
          value={formatRupiah(summary?.overdueAmount ?? 0)}
          tone={(summary?.overdueAmount ?? 0) > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader className="space-y-2 pb-2">
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Filter status pembayaran"
          >
            {(
              ["pending_payment", "paid", "cancelled", "all"] as StatusTab[]
            ).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={statusTab === t}
                onClick={() => setStatusTab(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  statusTab === t
                    ? "bg-mahakan-green-700 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                {STATUS_LABELS[t]}
                {t === "pending_payment" && summary
                  ? ` (${summary.outstandingCount})`
                  : t === "paid" && summary
                    ? ` (${summary.paidCount})`
                    : t === "cancelled" && summary
                      ? ` (${summary.cancelledCount})`
                      : ""}
              </button>
            ))}
          </div>
          {/* Saringan jatuh tempo hanya muncul saat melihat yang belum bayar. */}
          {dueFilterActive ? (
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Filter jatuh tempo"
            >
              {(["all", "due_soon", "overdue"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                    filter === f
                      ? "bg-neutral-800 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                  )}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyCard
              icon={CheckCircle2}
              title={
                statusTab === "pending_payment"
                  ? "Tidak ada hutang dagang berjalan"
                  : "Tidak ada data untuk filter ini"
              }
              description={
                statusTab === "pending_payment"
                  ? "Semua hutang tempo sudah lunas ✓ — buka tab 'Sudah Lunas' untuk lihat riwayatnya."
                  : "Ubah tab status di atas untuk lihat catatan lainnya."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tgl</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Supplier
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      Invoice
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-left font-medium">
                      {dueFilterActive ? "Due" : "Status"}
                    </th>
                    {/* Kolom pelunasan cuma relevan di luar tab belum-bayar. */}
                    {!dueFilterActive ? (
                      <th className="px-4 py-2 text-left font-medium">
                        Pelunasan
                      </th>
                    ) : null}
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((p) => {
                    const dueText = formatDueLabel(p.daysToDue);
                    const dueTone = formatDueTone(p.daysToDue);
                    return (
                      <tr key={p.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-mono text-xs">
                          {p.purchaseDate}
                        </td>
                        <td className="px-4 py-3">
                          {p.supplierName ?? (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {p.invoiceNo ?? (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatRupiah(p.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.status === "pending_payment" ? (
                            <>
                              <Badge variant={dueTone}>{dueText}</Badge>
                              {p.dueDate ? (
                                <p className="mt-0.5 text-[11px] text-neutral-500">
                                  {p.dueDate}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <Badge
                              variant={
                                p.status === "paid" ? "success" : "neutral"
                              }
                            >
                              {p.status === "paid"
                                ? "Lunas ✓"
                                : "Dibatalkan"}
                            </Badge>
                          )}
                        </td>
                        {!dueFilterActive ? (
                          <td className="px-4 py-3 text-xs">
                            {p.paidAt ? (
                              <>
                                <p className="text-neutral-800">
                                  {formatTanggal(p.paidAt)}
                                  {p.settlementMethod ? (
                                    <span className="text-neutral-500">
                                      {" · "}
                                      {SETTLE_LABELS[p.settlementMethod] ??
                                        p.settlementMethod}
                                    </span>
                                  ) : null}
                                </p>
                                <p className="text-[11px] text-neutral-500">
                                  {p.paidByName ?? "—"}
                                  {/* Nominal bayar bisa BEDA dari total pesanan
                                      karena basisnya barang yang diterima (GR),
                                      bukan yang dipesan — audit AE-181. */}
                                  {p.settlementAmount !== null &&
                                  p.settlementAmount !== p.totalAmount ? (
                                    <span className="ml-1 text-warning-700">
                                      dibayar {formatRupiah(p.settlementAmount)}
                                    </span>
                                  ) : null}
                                </p>
                              </>
                            ) : p.status === "cancelled" ? (
                              <span className="text-neutral-400">
                                {p.cancelReason ?? "—"}
                              </span>
                            ) : (
                              <span className="text-neutral-400">—</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-right">
                          {p.status === "paid" ? (
                            canFixPayDate ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setFixTarget(p);
                                  setFixDate(
                                    p.paidAt
                                      ? p.paidAt.slice(0, 10)
                                      : todayJakartaIso(),
                                  );
                                  setFixReason("");
                                }}
                                title="Koreksi tanggal pembayaran"
                              >
                                <CalendarClock className="size-4" aria-hidden />{" "}
                                Ubah Tanggal
                              </Button>
                            ) : (
                              <span className="text-xs text-neutral-400">—</span>
                            )
                          ) : p.status !== "pending_payment" ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : canMarkPaid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPayTarget(p);
                                setPayMethod("cash");
                                setPayDate(todayJakartaIso());
                              }}
                            >
                              <CheckCircle2
                                className="size-4"
                                aria-hidden
                              />{" "}
                              Tandai Lunas
                            </Button>
                          ) : (
                            <span className="text-xs italic text-neutral-400">
                              Manager+ only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sesi AE-188 — koreksi pelunasan yang terlanjur tercatat di tanggal
          klik, bukan tanggal uang keluar (permintaan staff). */}
      <Modal
        open={fixTarget !== null}
        onClose={() => {
          setFixTarget(null);
          setFixReason("");
        }}
        title="Ubah Tanggal Pembayaran"
        description={
          fixTarget
            ? `${fixTarget.supplierName ?? "Supplier"} · ${formatRupiah(fixTarget.totalAmount)}${
                fixTarget.paidAt
                  ? ` · tercatat ${formatTanggal(fixTarget.paidAt)}`
                  : ""
              }`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setFixTarget(null);
                setFixReason("");
              }}
              disabled={fixSubmitting}
            >
              Batal
            </Button>
            <Button onClick={onConfirmFixDate} loading={fixSubmitting}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <DatePicker
            label="Tanggal pembayaran yang benar"
            value={fixDate}
            onChange={(v) => setFixDate(v ?? todayJakartaIso())}
            maxDate={todayJakartaIso()}
            clearable={false}
            hint="Tanggal uang benar-benar keluar ke supplier."
          />
          <Input
            label="Alasan koreksi"
            placeholder="mis. dibayar Juli, baru sempat diinput Agustus"
            value={fixReason}
            onChange={(e) => setFixReason(e.target.value)}
          />
          <p className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Tanggal lunas, pengeluaran kas, dan <strong>jurnal umum</strong>{" "}
            ikut dipindah. Kalau pindah bulan, nomor jurnalnya diterbitkan
            ulang mengikuti periode baru. Periode yang sudah dikunci akan
            ditolak.
          </p>
        </div>
      </Modal>

      <Modal
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title="Tandai Lunas"
        description={
          payTarget
            ? `Total: ${formatRupiah(payTarget.totalAmount)}${
                payTarget.supplierName
                  ? ` · ${payTarget.supplierName}`
                  : ""
              }`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPayTarget(null)}
              disabled={paySubmitting}
            >
              Batal
            </Button>
            <Button onClick={onConfirmPaid} loading={paySubmitting}>
              Konfirmasi
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Sesi AE-188 — tanggal pembayaran (owner request). Bukan sekadar
              catatan: tanggal ini yang dipakai jurnal umum, jadi pelunasan
              yang baru sempat diinput hari ini tetap mendarat di periode
              saat uangnya benar-benar keluar. */}
          <DatePicker
            label="Tanggal Pembayaran"
            value={payDate}
            onChange={(v) => setPayDate(v ?? todayJakartaIso())}
            maxDate={todayJakartaIso()}
            clearable={false}
            hint="Tanggal uang benar-benar keluar. Dipakai juga sebagai tanggal jurnal umum & pengeluaran kas."
          />
          <Select
            label="Cara Bayar"
            options={PAY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={payMethod}
            onValueChange={(v) => setPayMethod(v as PaymentMethod)}
          />
          <p className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Setelah tandai lunas, entry kas dengan jumlah ini otomatis
            tercatat di Kas → Pengeluaran (jika ada kategori expense) —
            memakai tanggal di atas, sama dengan tanggal jurnalnya.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "info" | "warning" | "danger" | "neutral";
}) {
  const Icon =
    tone === "danger"
      ? AlertTriangle
      : tone === "warning"
        ? Clock
        : tone === "info"
          ? Clock
          : Clock;
  return (
    <div
      className={cn(
        "rounded-md p-3",
        tone === "info" && "bg-info-100/40 text-info-500",
        tone === "warning" && "bg-warning-100/40 text-warning-500",
        tone === "danger" && "bg-danger-100/60 text-danger-500",
        tone === "neutral" && "bg-neutral-100 text-neutral-700",
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
        <Icon className="size-4" aria-hidden /> {label}
      </div>
      <p className="mt-1 font-mono text-base font-bold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function formatDueLabel(days: number | null): string {
  if (days === null) return "Tanpa due";
  if (days < 0) return `Lewat ${Math.abs(days)} hari`;
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  return `${days} hari lagi`;
}

function formatDueTone(
  days: number | null,
): "danger" | "warning" | "info" | "neutral" {
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 3) return "warning";
  return "info";
}
