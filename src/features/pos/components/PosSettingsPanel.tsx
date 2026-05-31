"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CloudOff,
  Cloud,
  EyeOff,
  Info,
  Loader2,
  Printer,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@/components/ui";
import { PrinterControls } from "@/features/printer/PrinterControls";
import { useSession } from "@/features/auth/SessionProvider";
import { getOwnOutlet, type Outlet } from "@/features/outlets";
import { isOk, type Category, type MenuItem } from "@/features/menu";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { countPendingTransactions } from "@/lib/offline/queue";
import { syncPendingTransactions } from "@/lib/offline/sync";
import type { Shift } from "@/features/shifts";
import { MenuStatusCard } from "./MenuStatusCard";

const APP_VERSION = "Phase 2 Tier 1.1 (M22.X)";

type SettingsTab = "menu" | "printer" | "sync" | "info";

const SETTINGS_TABS: Array<{
  key: SettingsTab;
  label: string;
  icon: typeof EyeOff;
}> = [
  { key: "menu", label: "Status Menu", icon: EyeOff },
  { key: "printer", label: "Printer", icon: Printer },
  { key: "sync", label: "Sinkronisasi", icon: Cloud },
  { key: "info", label: "Info", icon: Info },
];

interface PosSettingsPanelProps {
  shift: Shift | null;
  menuItems: MenuItem[];
  categories: Category[];
  onMenuItemUpdated: (next: MenuItem) => void;
}

export function PosSettingsPanel({
  shift,
  menuItems,
  categories,
  onMenuItemUpdated,
}: PosSettingsPanelProps) {
  /* Sesi AE-170 — sub-tab biar nggak scroll jauh + card dilebarin (max-w-6xl).
   * Default ke Status Menu (paling sering dipakai operasional). */
  const [tab, setTab] = useState<SettingsTab>("menu");

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 touch:p-3 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <SettingsIcon className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              Pengaturan POS
            </h1>
            <p className="text-sm text-neutral-600">
              Setup printer, status menu, sinkronisasi, dan info kasir.
            </p>
          </div>
        </div>

        {/* Sub-tab bar */}
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {SETTINGS_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors touch:py-2.5 touch:text-[15px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  tab === t.key
                    ? "bg-mahakan-green-700 text-white"
                    : "text-neutral-700 hover:bg-neutral-100",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "menu" ? (
          <MenuStatusCard
            menuItems={menuItems}
            categories={categories}
            onItemUpdated={onMenuItemUpdated}
          />
        ) : tab === "printer" ? (
          <PrinterCard />
        ) : tab === "sync" ? (
          <SyncCard />
        ) : (
          <AboutCard shift={shift} />
        )}
      </div>
    </div>
  );
}

function PrinterCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thermal Printer</CardTitle>
        <CardDescription>
          Pasangkan printer Bluetooth (RPP02) ke perangkat ini supaya struk
          otomatis tercetak setiap transaksi sukses.
        </CardDescription>
      </CardHeader>
      <div className="px-6 pb-6">
        <PrinterControls />
      </div>
    </Card>
  );
}

function SyncCard() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    try {
      setPendingCount(await countPendingTransactions());
    } catch {
      setPendingCount(0);
    }
  }

  useEffect(() => {
    // Initial + interval refresh from external IDB source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, []);

  async function handleSyncNow() {
    if (syncing || !online || pendingCount === 0) return;
    setSyncing(true);
    try {
      const summary = await syncPendingTransactions();
      if (summary.succeeded > 0) {
        toast.success(`${summary.succeeded} transaksi tersinkron`);
      }
      if (summary.failed > 0) {
        toast.error(`${summary.failed} transaksi gagal sync`);
      }
      if (summary.attempted === 0) {
        toast.info("Tidak ada transaksi pending");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync gagal");
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sinkronisasi Offline</CardTitle>
        <CardDescription>
          Status koneksi internet dan transaksi yang masih nunggu di-upload
          ke server.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-6 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          {online ? (
            <Badge variant="success">
              <Cloud className="size-3.5" aria-hidden /> Online
            </Badge>
          ) : (
            <Badge variant="warning">
              <CloudOff className="size-3.5" aria-hidden /> Offline
            </Badge>
          )}

          {pendingCount > 0 ? (
            <Badge variant="info">
              {pendingCount} transaksi pending
            </Badge>
          ) : (
            <Badge variant="neutral">
              <CheckCircle2 className="size-3.5" aria-hidden /> Semua tersinkron
            </Badge>
          )}
        </div>

        <Button
          onClick={handleSyncNow}
          disabled={!online || syncing || pendingCount === 0}
          loading={syncing}
          variant="outline"
        >
          {syncing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {syncing ? "Sinkronisasi…" : "Sinkronisasi sekarang"}
        </Button>

        <p className="text-xs text-neutral-500">
          Pas offline, transaksi tetap bisa di-bayar dan disimpan lokal.
          Saat internet kembali, sistem otomatis upload — tombol ini cuma
          buat trigger manual kalau mau yakin.
        </p>
      </div>
    </Card>
  );
}

interface AboutCardProps {
  shift: Shift | null;
}

function AboutCard({ shift }: AboutCardProps) {
  const { session } = useSession();
  const [outlet, setOutlet] = useState<Outlet | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOwnOutlet().then((res) => {
      if (cancelled) return;
      if (isOk(res)) setOutlet(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const roleLabel =
    session?.user.role === "owner"
      ? "Owner"
      : session?.user.role === "manager"
        ? "Manager"
        : "Staff";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Info className="mr-2 inline size-5" aria-hidden /> Tentang Sesi Ini
        </CardTitle>
        <CardDescription>
          Info kasir, outlet, dan versi aplikasi yang sedang berjalan.
        </CardDescription>
      </CardHeader>
      <div className="px-6 pb-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Outlet">
            {outlet?.name ?? <span className="text-neutral-400">—</span>}
          </Row>
          <Row label="Kasir">
            {session?.user.name ?? "—"}{" "}
            <Badge variant="neutral" className="ml-1 text-[10px]">
              {roleLabel}
            </Badge>
          </Row>
          <Row label="Shift Aktif">
            {shift ? (
              <span className="font-mono text-neutral-700">
                {shift.id.slice(0, 8)}…
              </span>
            ) : (
              <span className="text-neutral-400">Belum buka shift</span>
            )}
          </Row>
          <Row label="Versi Aplikasi">
            <span className="font-mono text-neutral-600">{APP_VERSION}</span>
          </Row>
        </dl>
      </div>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="text-neutral-900">{children}</dd>
    </div>
  );
}
