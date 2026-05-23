"use client";

/**
 * Sesi AE-128 — Banner reminder aktifkan push notification.
 *
 * Owner request: tiap user login (owner/staff) yang belum aktifin push,
 * tampilkan banner gentle reminder + tombol "Aktifkan".
 *
 * Anti-noise rules:
 *   - Tidak tampil kalau browser tidak support push (Firefox desktop,
 *     Safari < 16.4 desktop, dll)
 *   - Tidak tampil kalau VAPID env kosong (no point reminder)
 *   - Tidak tampil kalau permission "denied" (user explicit block)
 *   - Tidak tampil kalau sudah subscribed di browser ini
 *   - Snooze 3 hari setelah klik "Nanti saja"
 *   - Snooze 30 hari setelah aktif sukses (untuk handle re-subscribe
 *     prompt karena resubscribe rare)
 *   - iOS: pakai pesan khusus (push butuh PWA install dulu di iOS Safari)
 *
 * Storage key:
 *   mahakan:push-reminder-snooze (number, ms timestamp)
 */

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { cn } from "@/lib/utils";

type Status =
  | "checking"
  | "hidden" /* tidak tampil sama sekali */
  | "snoozed"
  | "ready" /* siap subscribe — tampil banner CTA */
  | "ios-install-hint" /* Safari iOS sebelum install PWA */
  | "loading"; /* lagi subscribe-process */

const SNOOZE_KEY = "mahakan:push-reminder-snooze";
const SNOOZE_LATER_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari
const SNOOZE_SUBSCRIBED_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function readSnooze(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeSnooze(ms: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
  } catch {
    /* localStorage disabled — silently skip */
  }
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  return Boolean(
    (navigator as { standalone?: boolean }).standalone === true,
  );
}

export function NotificationReminderBanner() {
  const [status, setStatus] = useState<Status>("checking");
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof window === "undefined") return;
      /* eslint-disable react-hooks/set-state-in-effect */
      /* Capability checks. */
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("hidden");
        return;
      }
      if (!vapidPublic) {
        setStatus("hidden");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("hidden");
        return;
      }
      /* Snooze active? */
      const snoozeUntil = readSnooze();
      if (snoozeUntil > Date.now()) {
        setStatus("snoozed");
        return;
      }
      /* Already subscribed in browser? */
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setStatus("hidden");
          /* Refresh long snooze supaya tidak constantly poll. */
          writeSnooze(SNOOZE_SUBSCRIBED_MS);
          return;
        }
      } catch {
        if (cancelled) return;
      }
      /* iOS Safari quirk: web push hanya work setelah PWA installed ke
       * home screen. Kalau belum standalone, tampilkan hint khusus. */
      if (isIos() && !isStandalone()) {
        setStatus("ios-install-hint");
        return;
      }
      setStatus("ready");
      /* eslint-enable react-hooks/set-state-in-effect */
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublic]);

  async function handleSubscribe() {
    setStatus("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (perm === "denied") {
          setStatus("hidden");
          toast.error(
            "Notifikasi di-blokir browser. Buka Settings browser → Notifications → unblock.",
          );
        } else {
          setStatus("ready");
        }
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });
      const subJson = sub.toJSON();
      const res = await fetch("/api/v1/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(j?.error?.message ?? "Subscribe gagal");
      }
      writeSnooze(SNOOZE_SUBSCRIBED_MS);
      setStatus("hidden");
      toast.success(
        "Notifikasi aktif. Kamu akan terima alert sesuai preferensi di Settings.",
      );
    } catch (e) {
      setStatus("ready");
      toast.error(
        e instanceof Error ? e.message : "Gagal aktifkan notifikasi",
      );
    }
  }

  function handleSnooze() {
    writeSnooze(SNOOZE_LATER_MS);
    setStatus("snoozed");
  }

  if (status === "checking" || status === "hidden" || status === "snoozed") {
    return null;
  }

  /* iOS install hint banner. */
  if (status === "ios-install-hint") {
    return (
      <div className="mx-3 mt-3 flex flex-wrap items-start gap-3 rounded-md border border-info-300 bg-info-50 px-3 py-2.5 text-sm md:mx-4">
        <Bell className="mt-0.5 size-4 shrink-0 text-info-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-info-700">
            Aktifkan notifikasi (iOS)
          </p>
          <p className="text-xs text-neutral-700">
            Di iPhone, push notif jalan setelah <strong>install ke Home
            Screen</strong> dulu: tap tombol Share → &ldquo;Add to Home
            Screen&rdquo;. Setelah itu buka dari icon, banner aktivasi
            akan muncul lagi.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSnooze}
          className="shrink-0 rounded p-1 text-info-700/70 hover:bg-info-100 hover:text-info-700"
          aria-label="Tutup banner reminder"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  /* Default ready banner. */
  return (
    <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-mahakan-green-300 bg-mahakan-green-50 px-3 py-2.5 text-sm md:mx-4">
      <div className="flex flex-1 items-start gap-2 sm:items-center">
        <Bell
          className="mt-0.5 size-4 shrink-0 text-mahakan-green-700 sm:mt-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-mahakan-green-900">
            Aktifkan notifikasi
          </p>
          <p className="text-xs text-neutral-700">
            Terima alert real-time untuk setoran, PR, shift variance, dan
            event penting lainnya (sesuai kategori yang kamu pilih di
            Settings).
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSnooze}
          aria-label="Tunda 3 hari"
        >
          Nanti
        </Button>
        <Button
          size="sm"
          onClick={handleSubscribe}
          loading={status === "loading"}
          className={cn(status === "loading" ? "opacity-90" : "")}
        >
          <Bell className="size-4" aria-hidden /> Aktifkan
        </Button>
      </div>
    </div>
  );
}
