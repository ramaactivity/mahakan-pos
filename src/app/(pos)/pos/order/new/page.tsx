"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toast,
} from "@/components/ui";
import { useCartStore } from "@/features/pos/cartStore";
import type { OrderType } from "@/mocks/types";
import { cn } from "@/lib/utils";

export default function NewOrderPage() {
  const router = useRouter();
  const startDraft = useCartStore((s) => s.startDraft);

  const [pager, setPager] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const pagerNum = parseInt(pager, 10);
    if (!Number.isFinite(pagerNum) || pagerNum < 1 || pagerNum > 99) {
      setError("Pager harus angka 1-99");
      return;
    }
    const id = startDraft(pagerNum, orderType);
    toast.success(`Order baru dibuat — pager ${pagerNum}`);
    router.replace(`/pos/order/${id}`);
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link
        href="/pos"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Order Baru</CardTitle>
          <CardDescription>
            Masukin nomor pager + tipe order. Lo bisa hold beberapa order
            sekaligus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Nomor Pager"
              type="text"
              inputMode="numeric"
              value={pager}
              onChange={(e) => {
                setPager(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
                setError(null);
              }}
              placeholder="1-99"
              required
              autoFocus
            />
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-neutral-900">
                Tipe Order
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "takeaway", label: "Takeaway" },
                    { value: "dine_in", label: "Dine-in" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrderType(opt.value)}
                    className={cn(
                      "rounded-md border py-3 text-sm font-medium transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      orderType === opt.value
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-500">
                {error}
              </p>
            ) : null}
            <Button type="submit" fullWidth size="lg">
              Mulai Order
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
