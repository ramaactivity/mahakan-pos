"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root error]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-600">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-neutral-900">
              Terjadi kesalahan
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Ada masalah saat memuat halaman ini. Coba lagi, atau kembali ke
              beranda.
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-neutral-400">
                Ref: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2"
          >
            Ke beranda
          </Link>
          <Button onClick={reset}>Coba lagi</Button>
        </div>
      </div>
    </main>
  );
}
