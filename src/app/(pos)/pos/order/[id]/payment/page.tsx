"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  QrCode,
} from "lucide-react";
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
import { useCartStore } from "@/features/pos/cartStore";
import { useSession } from "@/features/auth/SessionProvider";
import { isOk, shiftService, transactionService } from "@/mocks/services";
import type { PaymentMethod, Shift } from "@/mocks/types";
import { computeDiscountAmount, computeTotal } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUICK_AMOUNTS = [50_000, 100_000, 200_000];

export default function PaymentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const draftId = params.id;
  const { session } = useSession();

  const draft = useCartStore((s) => s.drafts[draftId]);
  const subtotal = useCartStore((s) => s.getSubtotal(draftId));
  const discountAmount = useCartStore((s) => s.getDiscountAmount(draftId));
  const total = useCartStore((s) => s.getTotal(draftId));
  const removeDraft = useCartStore((s) => s.removeDraft);

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      const res = await shiftService.getActiveShift(session!.user.id);
      if (cancelled) return;
      if (isOk(res)) setShift(res.data);
      setShiftLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!draft || !session) return null;
  if (draft.items.length === 0) {
    router.replace(`/pos/order/${draftId}`);
    return null;
  }

  if (shiftLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  if (!shift) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tidak Ada Shift Aktif</CardTitle>
          <CardDescription>
            Buka shift dulu sebelum memproses pembayaran.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.replace("/pos/shift/open")}>
            Buka Shift
          </Button>
        </CardContent>
      </Card>
    );
  }

  const cashReceived = parseInt(cashInput || "0", 10) || 0;
  const cashChange = Math.max(0, cashReceived - total);
  const cashSufficient = method !== "cash" || cashReceived >= total;

  async function onSubmit() {
    if (submitting) return;
    if (!cashSufficient) {
      setError("Uang yang diterima kurang dari total");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await transactionService.createTransaction({
      clientRefId: `client-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      shiftId: shift!.id,
      cashierId: session!.user.id,
      pagerNumber: draft!.pagerNumber,
      orderType: draft!.orderType,
      items: draft!.items.map((item) => ({
        menuItemId: item.menuItemId,
        variant: item.variant,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        modifiersPriceDelta: item.modifiersPriceDelta,
        subtotal: item.subtotal,
        note: item.note,
        openPriceNote: item.openPriceNote,
        modifiers: item.modifiers.map((m) => ({
          modifierSlug: m.modifierSlug,
          selectedValue: m.selectedValue,
          priceDelta: m.priceDelta,
        })),
      })),
      subtotal,
      discountType: draft!.discount?.type ?? null,
      discountValue: draft!.discount?.value ?? null,
      discountAmount: computeDiscountAmount(subtotal, draft!.discount),
      discountReason: draft!.discountReason,
      total: computeTotal(subtotal, discountAmount),
      paymentMethod: method,
      cashReceived: method === "cash" ? cashReceived : null,
      cashChange: method === "cash" ? cashChange : null,
      discountApproverId: draft!.discountApproverId ?? undefined,
      discountApproverToken: draft!.discountApproverToken ?? undefined,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    const trxId = res.data.id;
    removeDraft(draftId);
    toast.success(`Transaksi ${res.data.transactionNumber} berhasil`);
    router.replace(`/pos/order/${draftId}/success?trxId=${trxId}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={`/pos/order/${draftId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke Order
      </Link>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Order Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pesanan
              <Badge variant="signature">
                Pager <span className="font-mono">{draft.pagerNumber}</span>
              </Badge>
              <Badge variant="neutral">
                {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {draft.items.map((item) => (
                <div
                  key={item.cartItemId}
                  className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-2 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-900">
                      {item.quantity}× {item.name}{" "}
                      {item.variant ? (
                        <span className="text-neutral-500">
                          ({item.variant === "hot" ? "Hot" : "Iced"})
                        </span>
                      ) : null}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <p className="text-xs text-neutral-500">
                        {item.modifiers
                          .map((m) => m.selectedLabel ?? m.modifierSlug)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {item.note ? (
                      <p className="text-xs italic text-neutral-600">
                        &ldquo;{item.note}&rdquo;
                      </p>
                    ) : null}
                    {item.openPriceNote ? (
                      <p className="text-xs italic text-neutral-700">
                        {item.openPriceNote}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-sm">
                    {formatRupiah(item.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
              <Row label="Subtotal" value={formatRupiah(subtotal)} muted />
              {draft.discount ? (
                <Row
                  label={`Diskon ${
                    draft.discount.type === "percent"
                      ? `(${draft.discount.value}%)`
                      : ""
                  }`}
                  value={`- ${formatRupiah(discountAmount)}`}
                  danger
                />
              ) : null}
              <div className="border-t border-neutral-200 pt-2">
                <Row label="TOTAL" value={formatRupiah(total)} bold />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Metode Bayar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                <MethodButton
                  active={method === "cash"}
                  onClick={() => setMethod("cash")}
                  label="Tunai"
                  Icon={Banknote}
                />
                <MethodButton
                  active={method === "qris"}
                  onClick={() => setMethod("qris")}
                  label="QRIS"
                  Icon={QrCode}
                />
                <MethodButton
                  active={method === "card_bca"}
                  onClick={() => setMethod("card_bca")}
                  label="Kartu BCA"
                  Icon={CreditCard}
                />
              </div>
            </CardContent>
          </Card>

          {method === "cash" ? (
            <Card>
              <CardHeader>
                <CardTitle>Uang Diterima</CardTitle>
                <CardDescription>
                  Masukin nominal yang dibayar customer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex h-14 items-center justify-end rounded-md border border-neutral-300 bg-white px-4 font-mono text-2xl font-bold">
                  {cashReceived > 0 ? formatRupiah(cashReceived) : "—"}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashInput(String(amt))}
                      className="rounded-md border border-neutral-300 bg-white py-2 text-sm font-medium hover:bg-neutral-100"
                    >
                      {formatRupiah(amt).replace("Rp ", "")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCashInput(String(total))}
                    className="rounded-md border border-mahakan-green-700 bg-mahakan-green-50 py-2 text-sm font-medium text-mahakan-green-900 hover:bg-mahakan-green-100"
                  >
                    Pas
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <NumKey
                      key={d}
                      label={d}
                      onPress={() => setCashInput((s) => s + d)}
                    />
                  ))}
                  <NumKey label="C" onPress={() => setCashInput("")} />
                  <NumKey
                    label="0"
                    onPress={() => setCashInput((s) => s + "0")}
                  />
                  <NumKey
                    label="⌫"
                    onPress={() => setCashInput((s) => s.slice(0, -1))}
                  />
                </div>
                <div className="rounded-md bg-neutral-100 p-3 text-sm">
                  <Row
                    label="Kembalian"
                    value={
                      cashReceived >= total
                        ? formatRupiah(cashChange)
                        : `Kurang ${formatRupiah(total - cashReceived)}`
                    }
                    bold
                    danger={!cashSufficient}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>
                  Konfirmasi {method === "qris" ? "QRIS" : "Kartu BCA"}
                </CardTitle>
                <CardDescription>
                  Customer scan QRIS / tap kartu di mesin EDC. Tap &ldquo;Sudah
                  Lunas&rdquo; setelah EDC sukses.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-700">
                  Total yang ditagih:{" "}
                  <span className="font-mono font-bold">
                    {formatRupiah(total)}
                  </span>
                </p>
              </CardContent>
            </Card>
          )}

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}

          <Button
            size="xl"
            onClick={onSubmit}
            loading={submitting}
            disabled={!cashSufficient}
            fullWidth
          >
            {method === "cash"
              ? `Konfirmasi Tunai ${formatRupiah(total)}`
              : method === "qris"
                ? `Sudah Lunas QRIS`
                : `Sudah Lunas Kartu`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border py-4 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white hover:bg-neutral-100",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  );
}

function NumKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-md border border-neutral-200 bg-white py-3 font-mono text-lg font-medium hover:bg-neutral-100 active:scale-95"
    >
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  danger,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        muted ? "text-neutral-500" : "text-neutral-900",
        danger ? "text-danger-500" : "",
        bold ? "text-base font-bold" : "",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("font-mono shrink-0 ml-2", bold ? "text-lg" : "")}>
        {value}
      </span>
    </div>
  );
}
