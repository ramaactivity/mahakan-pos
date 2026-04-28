"use client";

import { Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface FullscreenToggleProps {
  className?: string;
}

/**
 * Toggle browser fullscreen via the Fullscreen API. Useful on tablet POS
 * where the cashier wants every pixel of the screen for the order grid
 * (Android Chrome address bar + bottom nav take ~80px combined).
 *
 * On iOS Safari the Fullscreen API is restricted to video elements; in that
 * case the button no-ops and the user can still rely on PWA "Add to Home
 * Screen" (manifest already sets display=fullscreen).
 */
export function FullscreenToggle({ className }: FullscreenToggleProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function sync() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser refused (e.g. iOS Safari restriction). Swallow silently —
      // the button is best-effort UX, not a critical control.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        isFullscreen ? "Keluar mode fullscreen" : "Masuk mode fullscreen"
      }
      title={
        isFullscreen ? "Keluar fullscreen" : "Fullscreen — sembunyikan address bar"
      }
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        className,
      )}
    >
      {isFullscreen ? (
        <Minimize className="size-5" aria-hidden />
      ) : (
        <Maximize className="size-5" aria-hidden />
      )}
    </button>
  );
}
