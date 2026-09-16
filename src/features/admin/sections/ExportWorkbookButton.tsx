"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button, toast } from "@/components/ui";

/**
 * Sesi AE-231 — tombol unduh Excel bertata rias.
 *
 * Penyusun berkasnya dimuat malas di dalam `run()`: pustaka penulis Excel
 * berukuran ~900KB dan tidak boleh ikut bundel awal halaman.
 */
export function ExportWorkbookButton({
  build,
  label = "Unduh Excel",
  size = "sm",
}: {
  build: () => Promise<void>;
  label?: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await build();
      toast.success("Berkas Excel diunduh");
    } catch (e) {
      toast.error(
        e instanceof Error && e.message === "EMPTY"
          ? "Belum ada data untuk diunduh"
          : "Gagal menyiapkan berkas Excel",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size={size} onClick={run} disabled={busy}>
      <FileSpreadsheet className="size-4" />
      {busy ? "Menyiapkan…" : label}
    </Button>
  );
}
