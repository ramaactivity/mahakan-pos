import { AppUpdateBanner } from "@/features/pwa/AppUpdateBanner";
import { PosShell } from "@/features/pos/PosShell";

export default function PosPage() {
  return (
    <>
      <PosShell />
      {/* Sesi AE-223b — beri tahu perangkat kalau ada rilis baru; tanpa ini
       * tablet yang dibuka pagi hari menjalankan bundel lama sampai malam. */}
      <AppUpdateBanner />
    </>
  );
}
