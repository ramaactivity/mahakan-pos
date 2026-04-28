"use client";

import { useEffect, useState } from "react";
import {
  Bluetooth,
  Building2,
  Clock,
  Pencil,
  ScrollText,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import { getOwnOutlet, isOk, type Outlet } from "@/features/outlets";
import { PrinterControls } from "@/features/printer/PrinterControls";
import { formatRupiah } from "@/lib/format";
import { useSession } from "@/features/auth/SessionProvider";
import { BusinessInfoModal } from "./settings/BusinessInfoModal";
import { OperationalHoursModal } from "./settings/OperationalHoursModal";
import { ReceiptEditorModal } from "./settings/ReceiptEditorModal";
import { SettingsTunablesModal } from "./settings/SettingsTunablesModal";

type OperationalHours = NonNullable<Outlet["operationalHours"]>;

const DAY_LABELS: Record<keyof OperationalHours, string> = {
  mon: "Senin",
  tue: "Selasa",
  wed: "Rabu",
  thu: "Kamis",
  fri: "Jumat",
  sat: "Sabtu",
  sun: "Minggu",
};

type EditTarget = "business" | "hours" | "tunables" | "receipt" | null;

export function SettingsSection() {
  const { session } = useSession();
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditTarget>(null);

  const isOwner = session?.user.role === "owner";
  const canEditReceipt =
    session?.user.role === "owner" || session?.user.role === "manager";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (isOk(res)) setOutlet(res.data);
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

  function onSaved(next: Outlet) {
    setOutlet(next);
    setEdit(null);
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
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-5" aria-hidden /> Business Info
              </CardTitle>
              <CardDescription>
                Tampil di header struk + dokumen ekspor.
              </CardDescription>
            </div>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEdit("business")}
                aria-label="Edit info bisnis"
              >
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </div>
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
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-5" aria-hidden /> Jam Operasional
              </CardTitle>
              <CardDescription>
                Info display only — tidak enforce restriction di Phase 1.
              </CardDescription>
            </div>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEdit("hours")}
                aria-label="Edit jam operasional"
              >
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {outlet.operationalHours
              ? (Object.keys(outlet.operationalHours) as Array<
                  keyof OperationalHours
                >).map((day) => {
                  const h = outlet.operationalHours![day];
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
                })
              : null}
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
            Pair Bluetooth RPP02 untuk auto-print struk saat bayar. Chrome/Edge
            Android required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PrinterControls />
        </CardContent>
      </Card>

      {/* Receipt — dedicated card; Owner + Manager bisa edit */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ScrollText className="size-5" aria-hidden /> Format Struk
              </CardTitle>
              <CardDescription>
                Header promo, footer, info WiFi, dan baris tambahan yang dicetak
                di struk customer. Owner + Manager bisa edit.
              </CardDescription>
            </div>
            {canEditReceipt && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEdit("receipt")}
                aria-label="Edit format struk"
              >
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 md:grid-cols-2">
            <Field
              label="Header Promo"
              value={
                outlet.settings?.receipt?.headerLines &&
                outlet.settings.receipt.headerLines.length > 0
                  ? outlet.settings.receipt.headerLines.join(" / ")
                  : "—"
              }
              colSpan={2}
            />
            <Field
              label="Footer"
              value={`"${outlet.settings?.receipt?.footerText ?? "—"}"`}
              colSpan={2}
            />
            <Field
              label="WiFi SSID"
              value={outlet.settings?.receipt?.wifiSsid || "—"}
            />
            <Field
              label="WiFi Password"
              value={outlet.settings?.receipt?.wifiPassword ? "•••••••" : "—"}
            />
            <Field
              label="Baris Tambahan"
              value={
                outlet.settings?.receipt?.extraFooterLines &&
                outlet.settings.receipt.extraFooterLines.length > 0
                  ? outlet.settings.receipt.extraFooterLines.join(" / ")
                  : "—"
              }
              colSpan={2}
            />
          </dl>
        </CardContent>
      </Card>

      {/* Threshold + features — Owner only */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-5" aria-hidden /> Threshold &amp; Features
            </CardTitle>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEdit("tunables")}
                aria-label="Edit threshold &amp; features"
              >
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 md:grid-cols-2">
            <Field
              label="QR Rating di Struk"
              value={outlet.settings?.receipt?.showQrRating ? "Aktif" : "Mati"}
            />
            <Field
              label="Threshold Variance Shift"
              value={`> ${formatRupiah(outlet.settings?.thresholds?.shiftVarianceAlert ?? 10_000)} = warning`}
            />
            <Field
              label="HPP Visible ke Staff"
              value={outlet.settings?.features?.showHppToStaff ? "Ya" : "Tidak"}
            />
            <Field
              label="Loyalty (Phase 2)"
              value={outlet.settings?.features?.loyaltyEnabled ? "Aktif" : "Off"}
            />
            <Field
              label="Recipe / BOM (Phase 2)"
              value={outlet.settings?.features?.recipeEnabled ? "Aktif" : "Off"}
            />
            <Field
              label="Multi-outlet (Phase 4)"
              value={outlet.settings?.features?.multiOutletEnabled ? "Aktif" : "Off"}
            />
          </dl>
        </CardContent>
      </Card>

      <BusinessInfoModal
        open={edit === "business"}
        outlet={outlet}
        onClose={() => setEdit(null)}
        onSaved={onSaved}
      />
      <OperationalHoursModal
        open={edit === "hours"}
        outlet={outlet}
        onClose={() => setEdit(null)}
        onSaved={onSaved}
      />
      <SettingsTunablesModal
        open={edit === "tunables"}
        outlet={outlet}
        onClose={() => setEdit(null)}
        onSaved={onSaved}
      />
      <ReceiptEditorModal
        open={edit === "receipt"}
        outlet={outlet}
        onClose={() => setEdit(null)}
        onSaved={onSaved}
      />
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
