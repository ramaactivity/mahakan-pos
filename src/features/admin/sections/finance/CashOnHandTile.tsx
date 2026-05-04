"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Wallet } from "lucide-react";
import { fetchCashOnHand } from "@/features/finance/actions";
import type { CashOnHandSnapshot } from "@/features/finance/types";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

export function CashOnHandTile() {
  const { session } = useSession();
  const role = session?.user.role;
  const canView = role ? hasPermission(role, "cash_deposit.view") : false;

  const [snap, setSnap] = useState<CashOnHandSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let mounted = true;
    fetchCashOnHand()
      .then((res) => {
        if (!mounted) return;
        if (res.ok) setSnap(res.data);
        else setError(res.error.message);
      })
      .catch((e) =>
        mounted ? setError(e instanceof Error ? e.message : "Error") : null,
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [canView]);

  // Phase 6.2 — staff tidak punya cash_deposit.view; widget di-hide sepenuhnya
  // alih-alih nampilkan FORBIDDEN error (graceful untuk kasir POS context).
  if (!canView) return null;

  if (loading) {
    return <Skeleton className="h-24 w-72" />;
  }
  if (error || !snap) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        Cash on hand tidak terbaca {error ? `· ${error}` : ""}
      </div>
    );
  }

  const over = snap.isOverThreshold;
  return (
    <div
      className={cn(
        "min-w-[18rem] rounded-md border px-4 py-3",
        over
          ? "border-red-300 bg-red-50"
          : "border-mahakan-green-200 bg-mahakan-green-50",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <Wallet className="size-3.5" aria-hidden /> Cash on Hand
        {over ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            <AlertTriangle className="size-3" /> Over threshold
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-2xl font-bold text-neutral-900">
        {formatRupiah(snap.cashOnHand)}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        <dt>Pending setoran</dt>
        <dd className="text-right font-medium">
          {snap.pendingDepositCount}× ·{" "}
          {formatRupiah(snap.pendingDepositsAmount)}
        </dd>
        <dt>Verified setoran</dt>
        <dd className="text-right">
          {formatRupiah(snap.verifiedDepositsAmount)}
        </dd>
        <dt>Drawer aktif</dt>
        <dd className="text-right">
          {formatRupiah(snap.openShiftDrawerCash)}
        </dd>
        <dt>Threshold</dt>
        <dd className="text-right">{formatRupiah(snap.thresholdIdr)}</dd>
      </dl>
    </div>
  );
}
