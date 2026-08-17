"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bluetooth,
  Building2,
  Clock,
  Download,
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
import { ApprovalCodesPanel } from "./settings/ApprovalCodesPanel";
import { BankAccountsCard } from "./settings/BankAccountsCard";
import { BooksCutoffCard } from "./settings/BooksCutoffCard";
import { ResetMockupDataCard } from "./settings/ResetMockupDataCard";
import { PushNotificationToggle } from "@/features/push-notifications/PushNotificationToggle";
import { NotificationPreferencesPanel } from "@/features/push-notifications/NotificationPreferencesPanel";
import { InstallAppButton } from "@/features/pwa/InstallAppButton";

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
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<EditTarget>(null);

  const isOwner = session?.user.role === "owner";
  const canEditReceipt =
    session?.user.role === "owner" || session?.user.role === "manager";

  // Sesi AE-14 — TanStack Query.
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "self"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const outlet = outletQuery.data ?? null;
  const loading = outletQuery.isLoading;

  function refreshOutlet() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "outlet"] });
  }

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

  function onSaved(_next: Outlet) {
    void _next;
    refreshOutlet();
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

      {/* Sesi AE-125 — PWA install card. Bantu owner+staff install
       * Mahakan POS jadi aplikasi (home screen icon, fullscreen). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-5" aria-hidden /> Install Aplikasi (PWA)
          </CardTitle>
          <CardDescription>
            Install Mahakan POS ke home screen HP / desktop. Buka cepat
            tanpa browser, fullscreen, hemat data, dan push notif kerja
            lebih reliable. Gratis, tidak pakai App Store / Play Store.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <InstallAppButton />
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="font-semibold text-neutral-800">
              Tombol install tidak muncul? Coba manual:
            </p>
            <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
              <li>
                <strong>Chrome / Edge Android</strong>: menu (⋮) → &ldquo;Install
                app&rdquo;
              </li>
              <li>
                <strong>Safari iOS</strong>: tombol Share → &ldquo;Tambahkan ke
                Layar Utama&rdquo;
              </li>
              <li>
                <strong>Chrome / Edge desktop</strong>: icon install di address
                bar (kanan)
              </li>
              <li>
                <strong>Firefox</strong>: tidak support install desktop, tetap
                bisa buka via browser
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Sesi AE-123+124 — Notifikasi: 2 card.
       *   1. Aktivasi push per-device (subscribe browser → server).
       *   2. Preferences per-user (category toggles + quiet hours + snooze). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" aria-hidden /> Aktivasi Notifikasi (Per Device)
          </CardTitle>
          <CardDescription>
            Aktifkan supaya browser ini bisa terima notif real-time
            (walau tab tidak terbuka). <strong>Per browser/device</strong> —
            aktifkan di tiap perangkat yang sering kamu pakai (HP + laptop).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushNotificationToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" aria-hidden /> Preferensi Notifikasi
          </CardTitle>
          <CardDescription>
            Pilih kategori notif yang mau kamu terima + atur jam hening
            supaya tidak ke-ganggu. Aplikasi sudah set default cerdas
            sesuai peran kamu — boleh customize sesuka hati.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesPanel />
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
            <Field
              label="Auto-Journal Akuntansi (Phase 2)"
              value={
                outlet.settings?.features?.accounting_auto_journal
                  ? "Aktif — POS/payroll/setoran/aggregator otomatis di-jurnal"
                  : "Off — ledger kosong sampai Owner aktifkan post-test"
              }
            />
          </dl>
        </CardContent>
      </Card>

      <BankAccountsCard
        viewerRole={session?.user.role ?? "staff"}
      />

      {isOwner ? <ApprovalCodesPanel /> : null}

      {/* Sesi AE-207 — batas buku (sembunyikan data lama, bukan hapus). */}
      {isOwner ? (
        <BooksCutoffCard outlet={outlet} onSaved={refreshOutlet} />
      ) : null}

      {/* Sesi AE-32 — nuclear reset untuk transition mockup → trial. */}
      {isOwner ? <ResetMockupDataCard /> : null}

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
