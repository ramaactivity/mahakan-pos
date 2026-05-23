"use client";

/**
 * Sesi AE-123 — PushNotificationToggle.
 *
 * UI sederhana: 1 tombol "Aktifkan notifikasi" / "Nonaktifkan" + status.
 * Flow:
 *   1. User klik "Aktifkan" → request browser permission
 *   2. Kalau granted → pushManager.subscribe({ applicationServerKey: VAPID public })
 *   3. POST subscription ke /api/v1/push/subscribe
 *   4. Status state: idle / subscribed / unsupported / blocked / no-vapid
 *
 * Disable kalau:
 *   - Browser tidak support service worker / push (mis. old Safari)
 *   - VAPID public key tidak di-set di env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` kosong)
 *   - Permission "denied" (user block — tidak bisa unblock dari code)
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button, toast } from "@/components/ui";

type Status =
  | "checking"
  | "unsupported"
  | "no-vapid"
  | "blocked"
  | "idle"
  | "subscribed"
  | "loading";

/** base64-url decode → Uint8Array (backed by fresh ArrayBuffer, bukan
 * SharedArrayBuffer) untuk PushManager.subscribe applicationServerKey.
 * TS strict di Next.js 16 require BufferSource explicit ArrayBuffer-backed. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof window === "undefined") return;
      /* eslint-disable react-hooks/set-state-in-effect */
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      if (!vapidPublic) {
        setStatus("no-vapid");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("blocked");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(sub ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setStatus("idle");
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublic]);

  async function handleSubscribe() {
    setStatus("loading");
    try {
      /* Request notif permission (sekali per origin per browser). */
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "blocked" : "idle");
        toast.error(
          perm === "denied"
            ? "Notifikasi di-blokir browser. Buka Settings browser → Notifications → unblock."
            : "Permission notifikasi belum di-izinkan",
        );
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
        throw new Error(j?.error?.message ?? "Subscribe ke server gagal");
      }
      setStatus("subscribed");
      toast.success("Notifikasi aktif. Kamu akan terima alert saat ada setoran pending.");
    } catch (e) {
      setStatus("idle");
      toast.error(
        e instanceof Error ? e.message : "Gagal aktifkan notifikasi",
      );
    }
  }

  async function handleUnsubscribe() {
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(
          `/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
          { method: "DELETE" },
        );
      }
      setStatus("idle");
      toast.success("Notifikasi di-nonaktifkan");
    } catch (e) {
      setStatus("subscribed");
      toast.error(
        e instanceof Error ? e.message : "Gagal nonaktifkan notifikasi",
      );
    }
  }

  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" /> Memeriksa support notifikasi…
      </div>
    );
  }
  if (status === "unsupported") {
    return (
      <div className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        Browser ini tidak support Web Push. Pakai Chrome / Edge / Firefox /
        Safari 16+ di desktop atau Android.
      </div>
    );
  }
  if (status === "no-vapid") {
    return (
      <div className="rounded-md border border-warning-300 bg-warning-100/60 px-3 py-2 text-xs text-warning-700">
        Web Push belum di-setup di server (VAPID env kosong). Hubungi admin
        untuk aktifkan.
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="rounded-md border border-danger-300 bg-danger-100/40 px-3 py-2 text-xs text-danger-700">
        Notifikasi di-blokir di browser. Buka Settings browser → Notifications
        → pilih site ini → Allow.
      </div>
    );
  }
  if (status === "subscribed") {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mahakan-green-100 px-2.5 py-1 text-xs font-semibold text-mahakan-green-900">
          <Bell className="size-3" aria-hidden /> Notifikasi aktif
        </span>
        <Button variant="ghost" size="sm" onClick={handleUnsubscribe}>
          <BellOff className="size-4" aria-hidden /> Nonaktifkan
        </Button>
      </div>
    );
  }
  return (
    <Button
      onClick={handleSubscribe}
      loading={status === "loading"}
      variant="outline"
    >
      <Bell className="size-4" aria-hidden /> Aktifkan Notifikasi Setoran
    </Button>
  );
}
