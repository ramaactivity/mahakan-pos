"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Printer, Receipt } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  toast,
} from "@/components/ui";
import { isOk, transactionService } from "@/mocks/services";
import type { Transaction } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";

export default function SuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trxId = searchParams.get("trxId");

  const [trx, setTrx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trxId) {
      router.replace("/pos");
      return;
    }
    let cancelled = false;
    async function load() {
      const res = await transactionService.getTransaction(trxId!);
      if (cancelled) return;
      if (isOk(res)) setTrx(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [trxId, router]);

  if (loading || !trx) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-success-100">
          <CheckCircle2 className="size-10 text-success-500" aria-hidden />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">
            Transaksi Berhasil
          </h1>
          <p className="text-sm text-neutral-500">
            <span className="font-mono">{trx.transactionNumber}</span> ·{" "}
            Pager <span className="font-mono">{trx.pagerNumber}</span>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" /> Struk
          </CardTitle>
          <CardDescription>
            Preview struk — printer thermal terhubung di M16.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-900">
            <div className="text-center">
              <p className="font-bold">Mahakan Coffee &amp; Space</p>
              <p>Puncak Rd KM 22, Cisarua</p>
              <p>0838-1977-5665</p>
            </div>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <div className="space-y-0.5">
              <Line
                left={trx.transactionNumber}
                right={trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
              />
              <Line
                left="Pager"
                right={String(trx.pagerNumber)}
              />
              <Line
                left="Waktu"
                right={formatIndonesianDateTime(trx.createdAt)}
              />
            </div>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <div className="space-y-1">
              {trx.items.map((item) => (
                <div key={item.id}>
                  <Line
                    left={`${item.quantity}× ${item.itemName}${
                      item.variant
                        ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
                        : ""
                    }`}
                    right={formatRupiah(item.subtotal)}
                  />
                  {item.modifiers.length > 0 ? (
                    <p className="pl-3 text-[10px] text-neutral-600">
                      {item.modifiers
                        .map((m) => m.selectedValue ?? m.modifierSlug)
                        .join(", ")}
                    </p>
                  ) : null}
                  {item.openPriceNote ? (
                    <p className="pl-3 text-[10px] italic text-neutral-700">
                      {item.openPriceNote}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className="pl-3 text-[10px] italic text-neutral-600">
                      &ldquo;{item.note}&rdquo;
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <Line label="Subtotal" value={formatRupiah(trx.subtotal)} />
            {trx.discountAmount > 0 ? (
              <Line
                label={`Diskon ${
                  trx.discountType === "percent"
                    ? `${trx.discountValue}%`
                    : ""
                }`}
                value={`- ${formatRupiah(trx.discountAmount)}`}
              />
            ) : null}
            <Line label="TOTAL" value={formatRupiah(trx.total)} bold />
            <div className="my-1 border-t border-dashed border-neutral-300" />
            <Line
              label="Bayar"
              value={
                trx.paymentMethod === "cash"
                  ? `Tunai ${formatRupiah(trx.cashReceived ?? 0)}`
                  : trx.paymentMethod === "qris"
                    ? "QRIS"
                    : "Kartu BCA"
              }
            />
            {trx.paymentMethod === "cash" ? (
              <Line
                label="Kembali"
                value={formatRupiah(trx.cashChange ?? 0)}
              />
            ) : null}
            <div className="mt-3 text-center">
              <p className="text-[10px]">Terima kasih, sampai jumpa!</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          fullWidth
          onClick={() =>
            toast.info("Cetak ulang akan tersedia setelah M16 (printer)")
          }
        >
          <Printer className="size-4" aria-hidden /> Cetak Ulang
        </Button>
        <Button
          size="lg"
          fullWidth
          onClick={() => {
            const tid = trx?.id;
            if (!tid) {
              router.push("/pos");
              return;
            }
            void transactionService.markServed(tid);
            toast.success("Order ditandai selesai");
            router.push("/pos");
          }}
        >
          Selesai (Order Disiapkan)
        </Button>
      </div>

      <div className="flex justify-center">
        <Badge variant="paid">{trx.status === "paid" ? "Lunas" : trx.status}</Badge>
      </div>
    </div>
  );
}

function Line({
  left,
  right,
  label,
  value,
  bold,
}: {
  left?: string;
  right?: string;
  label?: string;
  value?: string;
  bold?: boolean;
}) {
  const l = left ?? label ?? "";
  const r = right ?? value ?? "";
  return (
    <div
      className={`flex items-start justify-between gap-2 ${
        bold ? "font-bold" : ""
      }`}
    >
      <span className="break-words flex-1 min-w-0">{l}</span>
      <span className="shrink-0">{r}</span>
    </div>
  );
}
