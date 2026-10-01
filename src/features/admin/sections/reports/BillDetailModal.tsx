"use client";

import { useEffect, useState } from "react";
import { Badge, Modal, Skeleton } from "@/components/ui";
import {
  getBillDetail,
  isOk,
  type BillDetail,
  type BillReduction,
  type BillTrailStep,
  type DetailItemChange,
  type DetailItemLine,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";
import type { PaymentMethod } from "@/features/transactions";
import { cn } from "@/lib/utils";

/* Sesi AE-237 — Detail Bill: isi bill, bill awal, riwayat edit, dan
 * pemeriksaan "turunnya pindah ke bill mana" (logika di bill-detail-pure). */

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const changes = (list: DetailItemChange[]) => list.map((c) => `${c.qty}× ${c.name}`).join(", ");

const STEP_LABEL: Record<string, string> = {
  create: "Bill disimpan",
  edit: "Bill diedit",
  close: "Dibayar",
  cancel: "Bill dibatalkan",
  split: "Pembayaran split",
  reprint: "Cetak ulang struk",
};

const VERDICT: Record<BillReduction["verdict"], { label: string; tone: "success" | "warning" | "danger" }> = {
  moved: { label: "Terbukti pindah: nominal & item cocok dengan bill lain", tone: "success" },
  likely_moved: { label: "Kemungkinan pindah: nominal sama, item tidak tercatat", tone: "warning" },
  paid_separately: {
    label: "Ada transaksi lain senilai total sebelum edit — kemungkinan pesanan asli dibayar terpisah",
    tone: "warning",
  },
  partial: { label: "Sebagian item muncul di bill lain, nominal tidak sama", tone: "warning" },
  item_mismatch: { label: "Ada bill senilai sama, tapi itemnya BERBEDA", tone: "danger" },
  no_trace: {
    label: "Tidak ada bill lain di shift ini yang menampung selisih ini — alasan pindah/split bill tidak didukung data",
    tone: "danger",
  },
};

const KIND_LABEL = {
  edit_up: "bill naik",
  new_bill: "bill baru",
  direct_sale: "transaksi langsung",
} as const;

export function BillDetailModal({
  transactionId,
  onClose,
}: {
  transactionId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;
    // Reset when the modal is reopened for another bill.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setError(null);
    void getBillDetail(transactionId).then((res) => {
      if (cancelled) return;
      if (isOk(res)) setDetail(res.data);
      else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  return (
    <Modal
      open={transactionId !== null}
      onClose={onClose}
      title={detail ? `Detail ${detail.transactionNumber}` : "Detail Bill"}
      description={detail ? `${detail.customerName ?? "Tanpa nama"} · dibuka ${fmt(detail.openedAt)}` : undefined}
      size="3xl"
    >
      {error ? (
        <p className="text-sm text-danger-500">{error}</p>
      ) : !detail ? (
        <div className="space-y-2" role="status" aria-label="Memuat detail bill">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <BillDetailBody d={detail} />
      )}
    </Modal>
  );
}

function BillDetailBody({ d }: { d: BillDetail }) {
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-neutral-50 p-3 sm:grid-cols-4">
        <Fact label="Total dibayar" value={formatRupiah(d.total)} mono />
        <Fact label="Metode" value={paymentMethodLabel(d.paymentMethod as PaymentMethod)} />
        <Fact
          label="Uang diterima"
          value={d.cashReceived !== null ? `${formatRupiah(d.cashReceived)} · kembali ${formatRupiah(d.cashChange ?? 0)}` : "-"}
        />
        <Fact label="Dibayar" value={d.paidAt ? fmt(d.paidAt) : d.status === "voided" ? "Dibatalkan" : "-"} />
        <Fact label="Crew buka" value={d.openedCrew ?? "-"} />
        <Fact label="Crew bayar" value={d.paidCrew ?? "-"} />
        <Fact label="Tablet" value={d.cashierName ?? "-"} />
        <Fact
          label="Split payment"
          value={
            d.splitPayments.length === 0
              ? "Tidak ada"
              : d.splitPayments.map((s) => `${paymentMethodLabel(s.paymentMethod as PaymentMethod)} ${formatRupiah(s.amount)}`).join(" + ")
          }
        />
      </dl>

      <Section title="Isi bill saat dibayar">
        <ItemTable items={d.items} />
        {d.discountAmount > 0 ? (
          <p className="mt-1 text-xs text-neutral-500">
            Diskon {formatRupiah(d.discountAmount)}
            {d.discountReason ? ` — ${d.discountReason}` : ""}
          </p>
        ) : null}
      </Section>

      {d.initial ? (
        <Section title={`Bill awal (disimpan ${fmt(d.initial.at)})`}>
          {d.initial.items ? (
            <ItemTable items={d.initial.items} />
          ) : (
            <NotRecorded>
              Total {formatRupiah(d.initial.total)}
              {d.initial.itemCount !== null ? `, ${d.initial.itemCount} baris item` : ""}. Nama item belum dicatat
              sistem saat itu (pencatatan item per edit aktif sejak 25 Sep 2026).
            </NotRecorded>
          )}
        </Section>
      ) : (
        <p className="text-xs text-neutral-500">Transaksi langsung (bukan open bill) — tidak ada riwayat edit.</p>
      )}

      {d.cartActivity.length > 0 ? (
        <Section title="Dihapus dari keranjang sebelum disimpan / dibayar">
          <ul className="space-y-1 text-xs">
            {d.cartActivity.map((c, i) => (
              <li key={`${c.at}-${i}`} className="rounded bg-warning-100/50 px-2 py-1 text-neutral-800">
                <span className="text-neutral-500">{fmt(c.at)}</span> — {c.summary}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {d.reductions.length > 0 ? (
        <Section title="Pemeriksaan pindah / split bill">
          <div className="space-y-3">
            {d.reductions.map((r) => (
              <ReductionCard key={r.at} r={r} />
            ))}
          </div>
          {d.shift ? (
            <p className="mt-2 text-xs text-neutral-500">
              Dicari di shift {fmt(d.shift.openedAt)} → {d.shift.closedAt ? fmt(d.shift.closedAt) : "masih buka"}, ±3 jam dari
              edit. Selisih kas shift: {d.shift.variance === null ? "-" : formatRupiah(d.shift.variance)}. Catatan: selisih 0
              tidak membuktikan bill aman — laci selalu cocok dengan total yang sudah diturunkan.
            </p>
          ) : null}
        </Section>
      ) : null}

      {d.trail.length > 0 ? (
        <Section title="Riwayat bill">
          <ol className="space-y-2">
            {d.trail.map((s, i) => (
              <TrailRow key={`${s.at}-${i}`} s={s} />
            ))}
          </ol>
        </Section>
      ) : null}
    </div>
  );
}

function ReductionCard({ r }: { r: BillReduction }) {
  const v = VERDICT[r.verdict];
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-danger-500">Turun {formatRupiah(r.amount)}</span>
        <span className="text-xs text-neutral-500">
          {formatRupiah(r.totalBefore)} → {formatRupiah(r.totalAfter)} · {fmt(r.at)}
        </span>
      </div>
      {r.removed ? (
        <p className="mt-1 text-xs text-neutral-700">
          {r.removed.length ? `Dihapus: ${changes(r.removed)}` : "Tidak ada item dihapus"}
          {r.added?.length ? ` · Ditambah: ${changes(r.added)}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">Item yang dihapus tidak tercatat (sebelum 25 Sep 2026).</p>
      )}
      <div className="mt-2">
        <Badge variant={v.tone} className="h-auto whitespace-normal py-1 text-left">{v.label}</Badge>
      </div>
      {r.candidates.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {r.candidates.map((c) => (
            <li key={`${c.transactionId}-${c.at}`} className="rounded bg-neutral-50 px-2 py-1">
              <span className="font-mono">{c.transactionNumber}</span>
              {c.customerName ? ` (${c.customerName})` : ""} — {KIND_LABEL[c.kind]} {formatRupiah(c.amount)},{" "}
              {c.minutesFromEdit >= 0 ? `${c.minutesFromEdit} mnt setelah` : `${-c.minutesFromEdit} mnt sebelum`} edit
              {c.amountMatch ? " · nominal = selisih" : ""}
              {c.fullBeforeMatch ? " · nominal = total sebelum edit" : ""}
              {c.itemMatches.length ? ` · item cocok: ${c.itemMatches.join(", ")}` : ""}
              {c.status === "voided" ? " · bill ini dibatalkan" : ""}
              {c.items?.length ? <div className="text-neutral-500">{changes(c.items)}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TrailRow({ s }: { s: BillTrailStep }) {
  const down = s.totalBefore !== null && s.totalAfter !== null && s.totalAfter < s.totalBefore;
  return (
    <li className={cn("rounded-md border border-neutral-200 px-3 py-2", down && "border-danger-100 bg-danger-100/40")}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-neutral-900">{STEP_LABEL[s.kind] ?? s.eventType}</span>
        <span className="text-xs text-neutral-500">{fmt(s.at)}</span>
        {s.totalAfter !== null ? (
          <span className="font-mono text-xs">
            {s.totalBefore !== null ? `${formatRupiah(s.totalBefore)} → ` : ""}
            {formatRupiah(s.totalAfter)}
          </span>
        ) : null}
        <span className="text-xs text-neutral-500">
          {s.crewName ? `crew ${s.crewName}` : ""}
          {s.actorName ? ` · tablet ${s.actorName}` : ""}
        </span>
      </div>
      {s.reason ? <p className="mt-1 text-xs text-neutral-800">Alasan: {s.reason}</p> : null}
      {s.removed?.length ? <p className="text-xs text-danger-500">Hapus: {changes(s.removed)}</p> : null}
      {s.added?.length ? <p className="text-xs text-mahakan-green-700">Tambah: {changes(s.added)}</p> : null}
      {s.items ? (
        <p className="text-xs text-neutral-500">Isi: {s.items.map((i) => `${i.qty}× ${i.name}`).join(", ") || "-"}</p>
      ) : s.kind === "create" || s.kind === "edit" ? (
        <p className="text-xs text-neutral-400">Nama item tidak tercatat.</p>
      ) : null}
    </li>
  );
}

function ItemTable({ items }: { items: DetailItemLine[] }) {
  if (items.length === 0) return <p className="text-xs text-neutral-500">Tidak ada item.</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-neutral-100">
        {items.map((i, idx) => (
          <tr key={`${i.name}-${idx}`}>
            <td className="py-1 pr-2 text-neutral-700">
              {i.qty}× {i.name}
            </td>
            <td className="py-1 text-right font-mono">{formatRupiah(i.subtotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function NotRecorded({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-warning-100/50 px-3 py-2 text-xs text-neutral-700">{children}</p>;
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className={cn("text-neutral-900", mono && "font-mono font-semibold")}>{value}</dd>
    </div>
  );
}
