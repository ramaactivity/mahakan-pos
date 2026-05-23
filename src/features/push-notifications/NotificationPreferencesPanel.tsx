"use client";

import { useEffect, useMemo, useState } from "react";
import { BellOff, Clock, MoonStar } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
/* Import langsung dari sub-module supaya tidak nyangkut server.ts
 * (server-only). index.ts barrel campur server + client, NotifPanel
 * adalah client component. */
import {
  CATEGORY_META,
  formatMinutesOfDay,
  parseMinutesOfDay,
  type NotificationCategory,
} from "@/features/push-notifications/categories";
import {
  fetchOwnNotificationSettings,
  setNotificationCategoryEnabled,
  setNotificationCategorySnooze,
  setNotificationQuietHours,
  type UserNotificationPreference,
  type UserNotificationSettings,
} from "@/features/push-notifications/preferences-actions";
import { cn } from "@/lib/utils";

const SNOOZE_OPTIONS = [
  { value: "1", label: "1 jam" },
  { value: "8", label: "8 jam" },
  { value: "24", label: "1 hari" },
  { value: "168", label: "1 minggu" },
];

const GROUP_LABEL: Record<string, string> = {
  operasi: "Operasional",
  keuangan: "Keuangan",
  lainnya: "Lain-lain",
};

export function NotificationPreferencesPanel() {
  const [settings, setSettings] = useState<UserNotificationSettings | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [quietStartStr, setQuietStartStr] = useState("");
  const [quietEndStr, setQuietEndStr] = useState("");
  const [savingQuiet, setSavingQuiet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchOwnNotificationSettings();
      if (cancelled) return;
      /* eslint-disable react-hooks/set-state-in-effect */
      if (res.ok) {
        setSettings(res.data);
        setQuietStartStr(formatMinutesOfDay(res.data.quietStartMin));
        setQuietEndStr(formatMinutesOfDay(res.data.quietEndMin));
      } else {
        toast.error(res.error.message);
      }
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleCategory(
    category: NotificationCategory,
    nextEnabled: boolean,
  ) {
    /* Optimistic update. */
    const prev = settings;
    if (settings) {
      setSettings({
        ...settings,
        preferences: settings.preferences.map((p) =>
          p.category === category
            ? { ...p, enabled: nextEnabled, isDefault: false }
            : p,
        ),
      });
    }
    const res = await setNotificationCategoryEnabled(category, nextEnabled);
    if (!res.ok) {
      toast.error(res.error.message);
      if (prev) setSettings(prev);
    }
  }

  async function handleSnooze(
    category: NotificationCategory,
    hoursStr: string,
  ) {
    const hours = hoursStr === "0" ? null : Number(hoursStr);
    const res = await setNotificationCategorySnooze(category, hours);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    if (settings) {
      setSettings({
        ...settings,
        preferences: settings.preferences.map((p) =>
          p.category === category
            ? { ...p, snoozeUntil: res.data.snoozeUntil, isDefault: false }
            : p,
        ),
      });
    }
    toast.success(
      hours
        ? `${CATEGORY_META[category].label} di-snooze ${hoursStr}h`
        : `Snooze ${CATEGORY_META[category].label} dibatalkan`,
    );
  }

  async function handleSaveQuietHours() {
    const startMin = parseMinutesOfDay(quietStartStr);
    const endMin = parseMinutesOfDay(quietEndStr);
    if (startMin === null || endMin === null) {
      toast.error("Format jam tidak valid (HH:MM 00:00-23:59)");
      return;
    }
    setSavingQuiet(true);
    const res = await setNotificationQuietHours(startMin, endMin);
    setSavingQuiet(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    if (settings) {
      setSettings({ ...settings, quietStartMin: startMin, quietEndMin: endMin });
    }
    toast.success(
      startMin === endMin
        ? "Quiet hours dimatikan (notif 24/7)"
        : `Quiet hours ${formatMinutesOfDay(startMin)}-${formatMinutesOfDay(endMin)} aktif`,
    );
  }

  const groupedPreferences = useMemo(() => {
    if (!settings) return null;
    const byGroup: Record<string, UserNotificationPreference[]> = {
      operasi: [],
      keuangan: [],
      lainnya: [],
    };
    for (const p of settings.preferences) {
      const group = CATEGORY_META[p.category].group;
      byGroup[group].push(p);
    }
    return byGroup;
  }, [settings]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!settings || !groupedPreferences) {
    return (
      <p className="text-sm text-neutral-500">
        Tidak bisa muat pengaturan notifikasi.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quiet hours card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MoonStar className="size-4" aria-hidden /> Jam Hening (Quiet Hours)
          </CardTitle>
          <p className="text-xs text-neutral-600">
            Selama jam ini, notif <strong>tidak akan push</strong> (kecuali
            kategori urgent seperti Sistem). Set jam mulai = jam akhir untuk
            disable quiet hours (notif 24/7).
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Mulai"
              type="time"
              value={quietStartStr}
              onChange={(e) => setQuietStartStr(e.target.value)}
              className="w-32"
            />
            <Input
              label="Sampai"
              type="time"
              value={quietEndStr}
              onChange={(e) => setQuietEndStr(e.target.value)}
              className="w-32"
            />
            <Button onClick={handleSaveQuietHours} loading={savingQuiet}>
              Simpan Jam Hening
            </Button>
            {settings.quietStartMin === settings.quietEndMin ? (
              <span className="text-xs font-medium text-warning-700">
                Quiet hours OFF — notif 24/7
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Categories per group */}
      <div className="space-y-3">
        {(["operasi", "keuangan", "lainnya"] as const).map((groupKey) => {
          const items = groupedPreferences[groupKey];
          if (items.length === 0) return null;
          return (
            <Card key={groupKey}>
              <CardHeader>
                <CardTitle className="text-sm uppercase tracking-wider text-neutral-600">
                  {GROUP_LABEL[groupKey]}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((pref) => (
                  <CategoryRow
                    key={pref.category}
                    pref={pref}
                    onToggle={handleToggleCategory}
                    onSnooze={handleSnooze}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-[11px] text-neutral-500">
        <strong>Default smart:</strong> Subscribe otomatis sesuai role/email
        kamu (mis. Bayu HR → absensi+payroll, Inab Finance → setoran+tutup
        bulanan). Override kapan saja via toggle di atas. Tag &ldquo;Default
        smart&rdquo; berarti belum kamu customize.
      </p>
    </div>
  );
}

function CategoryRow({
  pref,
  onToggle,
  onSnooze,
}: {
  pref: UserNotificationPreference;
  onToggle: (
    category: NotificationCategory,
    enabled: boolean,
  ) => void | Promise<void>;
  onSnooze: (
    category: NotificationCategory,
    hours: string,
  ) => void | Promise<void>;
}) {
  const meta = CATEGORY_META[pref.category];
  const snoozeActive =
    pref.snoozeUntil !== null && pref.snoozeUntil.getTime() > Date.now();
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-md border p-3",
        pref.enabled
          ? "border-mahakan-green-200 bg-mahakan-green-50/40"
          : "border-neutral-200 bg-neutral-50",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-neutral-900">{meta.label}</p>
          {pref.isDefault ? (
            <span className="rounded bg-info-100 px-1.5 py-0.5 text-[10px] font-medium text-info-700">
              Default smart
            </span>
          ) : null}
          {snoozeActive && pref.snoozeUntil ? (
            <span className="inline-flex items-center gap-1 rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-medium text-warning-700">
              <Clock className="size-2.5" aria-hidden /> Snooze sampai{" "}
              {pref.snoozeUntil.toLocaleString("id-ID", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-neutral-600">{meta.description}</p>
      </div>
      <div className="flex items-center gap-2">
        {pref.enabled && !snoozeActive ? (
          <Select
            options={[
              { value: "", label: "Snooze…" },
              ...SNOOZE_OPTIONS,
            ]}
            value=""
            onValueChange={(v) => {
              if (v) onSnooze(pref.category, v);
            }}
            ariaLabel={`Snooze ${meta.label}`}
          />
        ) : snoozeActive ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSnooze(pref.category, "0")}
          >
            <BellOff className="size-4" aria-hidden /> Hapus snooze
          </Button>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={pref.enabled}
          onClick={() => onToggle(pref.category, !pref.enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
            pref.enabled ? "bg-mahakan-green-700" : "bg-neutral-300",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-5 rounded-full bg-white shadow ring-0 transition-transform",
              pref.enabled ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </div>
  );
}
