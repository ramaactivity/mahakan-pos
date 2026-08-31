import { AppUpdateBanner } from "@/features/pwa/AppUpdateBanner";
import { AdminShell } from "@/features/admin/AdminShell";

export default function DashboardPage() {
  return (
    <>
      <AdminShell />
      {/* Sesi AE-223b — beri tahu perangkat kalau ada rilis baru; tanpa ini
       * tablet yang dibuka pagi hari menjalankan bundel lama sampai malam. */}
      <AppUpdateBanner />
    </>
  );
}
