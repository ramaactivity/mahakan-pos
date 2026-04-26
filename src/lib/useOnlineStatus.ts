"use client";

import { useEffect, useState } from "react";

/**
 * Tracks navigator.onLine. Defaults to `true` on the server to avoid
 * flashing an offline banner during SSR. Caller should treat it as a
 * hint, not authoritative — the browser's onLine state can lie (e.g.
 * the user is on wifi but the AP has no internet). Pair with sync
 * retries that probe the network.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    // Sync from runtime on mount; eslint-disable: external source
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
