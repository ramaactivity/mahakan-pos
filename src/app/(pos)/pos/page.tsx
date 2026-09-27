import { AppUpdateBanner } from "@/features/pwa/AppUpdateBanner";
import { PosShell } from "@/features/pos/PosShell";
import { CrewPickerProvider } from "@/features/crew/CrewPicker";

export default function PosPage() {
  return (
    <>
      {/* Sesi AE-235 — every POS action asks which crew is serving. */}
      <CrewPickerProvider>
        <PosShell />
      </CrewPickerProvider>
      {/* Sesi AE-223b — beri tahu perangkat kalau ada rilis baru; tanpa ini
       * tablet yang dibuka pagi hari menjalankan bundel lama sampai malam. */}
      <AppUpdateBanner />
    </>
  );
}
