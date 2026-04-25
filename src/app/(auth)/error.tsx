"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[auth error]", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-600">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-neutral-900">
            Login bermasalah
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Sistem login tidak bisa dimuat. Coba lagi atau muat ulang halaman.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-neutral-400">
              Ref: {error.digest}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={reset}>Coba lagi</Button>
      </div>
    </div>
  );
}
