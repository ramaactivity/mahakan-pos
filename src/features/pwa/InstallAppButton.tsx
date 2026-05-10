"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";

/**
 * Sesi AE-24 — PWA install button untuk Android Chrome.
 *
 * Owner feedback: /m gabisa "Add to Home Screen" sebagai PWA — Chrome
 * cuma bikin shortcut biasa (icon dengan glyph Chrome di pojok). Penyebab:
 * Chrome auto-install prompt punya banyak prerequisite (engagement
 * heuristics) — sering tidak muncul walau manifest valid.
 *
 * Solusi: dengar event `beforeinstallprompt`, simpan referensi-nya, dan
 * expose tombol "Install App" yang panggil prompt() saat di-tap.
 *
 * Behavior:
 *   - iOS Safari: tidak ada beforeinstallprompt → tampilkan instruksi
 *     manual "Tap Share → Add to Home Screen".
 *   - Android Chrome: tombol jalan → native install dialog.
 *   - Sudah installed (display-mode standalone): tombol disembunyikan.
 *   - Belum siap install (event belum ke-fire): tombol disembunyikan
 *     untuk Android, instruction muncul untuk iOS.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari uses navigator.standalone; everyone else uses display-mode media query.
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  // iOS Safari proprietary
  return Boolean(
    (navigator as { standalone?: boolean }).standalone === true,
  );
}

interface Props {
  className?: string;
  /** Label untuk tombol Android. Default "Install Aplikasi". */
  label?: string;
}

export function InstallAppButton({ className, label = "Install Aplikasi" }: Props) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setInstalled(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed) return null;

  // iOS path — show instruction modal trigger.
  if (isIos()) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIosHint(true)}
          className={
            className ??
            "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-mahakan-green-700/30 bg-white px-4 py-3 text-sm font-semibold text-mahakan-green-900 transition-colors hover:bg-mahakan-green-50 active:scale-[0.99]"
          }
        >
          <Smartphone className="size-4" /> Pasang ke Home Screen
        </button>
        {showIosHint ? (
          <div
            role="dialog"
            aria-modal
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
            onClick={() => setShowIosHint(false)}
          >
            <div
              className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-bold text-mahakan-green-900">
                Pasang Mahakan Karyawan
              </h2>
              <ol className="mt-3 space-y-2 text-sm text-neutral-700">
                <li>
                  <span className="font-semibold">1.</span> Tap tombol{" "}
                  <span className="font-semibold">Share</span> (icon kotak +
                  panah ke atas) di Safari.
                </li>
                <li>
                  <span className="font-semibold">2.</span> Pilih{" "}
                  <span className="font-semibold">Add to Home Screen</span>.
                </li>
                <li>
                  <span className="font-semibold">3.</span> Tap{" "}
                  <span className="font-semibold">Add</span> di pojok kanan
                  atas. Icon Mahakan akan muncul di home screen.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIosHint(false)}
                className="mt-4 w-full rounded-lg bg-mahakan-green-700 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Mengerti
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // Android path — only show button if event ready.
  if (!deferredPrompt) {
    return null;
  }

  async function onInstall() {
    if (!deferredPrompt || submitting) return;
    setSubmitting(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
    } catch {
      // user dismissed or browser rejected — keep prompt for retry
    } finally {
      setDeferredPrompt(null);
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={submitting}
      className={
        className ??
        "flex w-full items-center justify-center gap-2 rounded-xl bg-mahakan-green-700 px-4 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-mahakan-green-900 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
      }
    >
      <Download className="size-4" />
      {submitting ? "Memproses…" : label}
    </button>
  );
}
