"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ClipboardList,
  Lock,
  Plus,
  Receipt,
  Wallet,
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
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { useCartStore } from "@/features/pos/cartStore";
import { isOk, shiftService, transactionService } from "@/mocks/services";
import type { Shift, Transaction } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime } from "@/lib/date";

export default function PosDashboardPage() {
  const router = useRouter();
  const { session } = useSession();
  const drafts = useCartStore((s) => s.getDraftsList());

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [activeOrders, setActiveOrders] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      const userId = session!.user.id;
      const [activeShiftRes, trxRes] = await Promise.all([
        shiftService.getActiveShift(userId),
        transactionService.listTransactions({ status: "paid", limit: 20 }),
      ]);
      if (cancelled) return;
      if (isOk(activeShiftRes)) setShift(activeShiftRes.data);
      if (isOk(trxRes)) {
        const today = new Date().toISOString().slice(0, 10);
        setActiveOrders(
          trxRes.data.items.filter(
            (t) =>
              t.servedAt === null &&
              t.createdAt.slice(0, 10) === today,
          ),
        );
      }
      setShiftLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Selamat bekerja, {session.user.name}
        </h1>
        <p className="text-sm text-neutral-700">
          Dashboard POS — buka shift untuk mulai transaksi.
        </p>
      </header>

      {/* Shift Status */}
      {shiftLoading ? (
        <Card>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-6 text-mahakan-green-700" />
            </div>
          </CardContent>
        </Card>
      ) : shift ? (
        <Card variant="emphasis">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-mahakan-green-900">
              <Wallet className="size-5" /> Shift Aktif
            </CardTitle>
            <CardDescription>
              Mulai {formatIndonesianTime(shift.openedAt)} WIB · Kas awal{" "}
              {formatRupiah(shift.openingCash)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => router.push("/pos/order/new")}
              >
                <Plus className="size-5" /> Order Baru
              </Button>
              <Link
                href="/pos/history"
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-base font-medium text-neutral-900 hover:bg-neutral-100"
              >
                <Receipt className="size-5" aria-hidden /> Riwayat Hari Ini
              </Link>
              <Link
                href="/pos/shift/close"
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-base font-medium text-neutral-900 hover:bg-neutral-100"
              >
                <Lock className="size-5" aria-hidden /> Tutup Shift
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Shift Belum Dibuka</CardTitle>
            <CardDescription>
              Lo perlu buka shift dulu — input kas awal yang ada di laci.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" onClick={() => router.push("/pos/shift/open")}>
              Buka Shift
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Drafts (multi-order hold) */}
      {shift && drafts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-5" /> Draft Order ({drafts.length})
            </CardTitle>
            <CardDescription>
              Order yang belum dibayar — ketuk untuk lanjut.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {drafts.map((draft) => (
                <Link
                  key={draft.id}
                  href={`/pos/order/${draft.id}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 hover:border-mahakan-green-700 hover:shadow-sm transition-all"
                >
                  <div>
                    <p className="font-mono text-sm font-bold text-neutral-900">
                      Pager {draft.pagerNumber}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"} ·{" "}
                      {draft.items.length} item
                    </p>
                  </div>
                  <ChevronRight
                    className="size-5 text-neutral-400"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Active orders (paid but not served) */}
      {shift && activeOrders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Order Belum Dihidangkan ({activeOrders.length})</CardTitle>
            <CardDescription>
              Sudah bayar, tunggu disiapkan barista. Tap &ldquo;Selesai&rdquo;
              pas udah keluar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activeOrders.map((trx) => (
                <Link
                  key={trx.id}
                  href={`/pos/history/${trx.id}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 hover:border-mahakan-green-700 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-mahakan-green-100 px-3 py-1 font-mono text-sm font-bold text-mahakan-green-800">
                      P{trx.pagerNumber}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {trx.transactionNumber}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"} ·{" "}
                        {trx.items.length} item ·{" "}
                        {formatIndonesianTime(trx.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="paid">{formatRupiah(trx.total)}</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
