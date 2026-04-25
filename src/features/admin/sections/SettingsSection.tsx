"use client";

import { useEffect, useState } from "react";
import { Bluetooth, Building2, Clock, ScrollText } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import { mockOutlet } from "@/mocks/data";
import type { Outlet } from "@/mocks/types";
import { delay } from "@/mocks/services/_helpers";
import { formatRupiah } from "@/lib/format";

const DAY_LABELS: Record<keyof Outlet["operationalHours"], string> = {
  mon: "Senin",
  tue: "Selasa",
  wed: "Rabu",
  thu: "Kamis",
  fri: "Jumat",
  sat: "Sabtu",
  sun: "Minggu",
};

export function SettingsSection() {
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Mock: just pull from constant. Real: settingsService.getOutlet
      await delay(150);
      if (cancelled) return;
      setOutlet(mockOutlet);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !outlet) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Memuat settings">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">Settings</h1>
        <p className="text-sm text-neutral-700">
          Konfigurasi outlet, printer, jam operasional, threshold.
        </p>
      </header>

      {/* Business Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5" aria-hidden /> Business Info
          </CardTitle>
          <CardDescription>
            Tampil di header struk + email. Edit form Owner-only akan ada di
            milestone berikut.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 md:grid-cols-2">
            <Field label="Nama" value={outlet.name} />
            <Field label="Telepon" value={outlet.phone ?? "—"} />
            <Field
              label="Alamat"
              value={outlet.address ?? "—"}
              colSpan={2}
            />
            <Field label="Logo URL" value={outlet.logoUrl ?? "—"} />
            <Field
              label="Status"
              value={outlet.isActive ? "Active" : "Inactive"}
            />
          </dl>
        </CardContent>
      </Card>

      {/* Operational Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5" aria-hidden /> Jam Operasional
          </CardTitle>
          <CardDescription>
            Info display only — tidak enforce restriction di Phase 1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(outlet.operationalHours) as Array<
              keyof Outlet["operationalHours"]
            >).map((day) => {
              const h = outlet.operationalHours[day];
              return (
                <div
                  key={day}
                  className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium text-neutral-900">
                    {DAY_LABELS[day]}
                  </span>
                  <span className="font-mono text-sm text-neutral-700">
                    {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Tutup"}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Printer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bluetooth className="size-5" aria-hidden /> Thermal Printer
          </CardTitle>
          <CardDescription>
            Pair Bluetooth RPP02 + test print. Implementasi di M16.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge variant="warning">Belum di-pair</Badge>
            <p className="text-sm text-neutral-500">
              Web Bluetooth perlu Chrome/Edge Android — fitur landing di M16.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Receipt + thresholds + features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-5" aria-hidden /> Receipt &amp; Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 md:grid-cols-2">
            <Field
              label="Footer Struk"
              value={`"${outlet.settings.receipt.footerText}"`}
              colSpan={2}
            />
            <Field
              label="QR Rating di Struk"
              value={outlet.settings.receipt.showQrRating ? "Aktif" : "Mati"}
            />
            <Field
              label="Threshold Variance Shift"
              value={`> ${formatRupiah(outlet.settings.thresholds.shiftVarianceAlert)} = warning`}
            />
            <Field
              label="HPP Visible ke Staff"
              value={outlet.settings.features.showHppToStaff ? "Ya" : "Tidak"}
            />
            <Field
              label="Loyalty (Phase 2)"
              value={outlet.settings.features.loyaltyEnabled ? "Aktif" : "Off"}
            />
            <Field
              label="Recipe / BOM (Phase 2)"
              value={outlet.settings.features.recipeEnabled ? "Aktif" : "Off"}
            />
            <Field
              label="Multi-outlet (Phase 4)"
              value={outlet.settings.features.multiOutletEnabled ? "Aktif" : "Off"}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  colSpan,
}: {
  label: string;
  value: string;
  colSpan?: 2;
}) {
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-neutral-900 break-words">
        {value}
      </dd>
    </div>
  );
}
