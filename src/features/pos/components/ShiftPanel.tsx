"use client";

import { Lock, Wallet } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@/components/ui";
import type { Shift } from "@/features/shifts";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime } from "@/lib/date";

interface ShiftPanelProps {
  shift: Shift | null;
  loading: boolean;
  onRequestOpenShift: () => void;
  onRequestCloseShift: () => void;
}

export function ShiftPanel({
  shift,
  loading,
  onRequestOpenShift,
  onRequestCloseShift,
}: ShiftPanelProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Shift</h2>
        <p className="text-sm text-neutral-500">
          Manage opening & closing kas. Tidak bisa transaksi tanpa shift aktif.
        </p>
      </header>

      {shift ? (
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
            <Button
              size="lg"
              variant="destructive"
              onClick={onRequestCloseShift}
            >
              <Lock className="size-5" aria-hidden /> Tutup Shift
            </Button>
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
            <Button size="lg" onClick={onRequestOpenShift}>
              Buka Shift
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
