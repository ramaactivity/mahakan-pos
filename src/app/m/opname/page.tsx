import Link from "next/link";
import { ArrowLeft, PackageSearch, Wrench } from "lucide-react";

/**
 * Sesi AD-9 scaffold — Stock Opname mobile module placeholder.
 *
 * Full implementation deferred to next sesi (AD-10):
 *   - List ingredients grouped by section (Bar / Kitchen / Cleaning / Supporting)
 *   - Per-ingredient input "Jumlah Fisik" (numpad)
 *   - Auto-compare vs system stock, show variance
 *   - Submit to opname_session (uses existing finalizeOpname action)
 *   - Auto-redirect to home setelah submit
 *
 * For now: explainer + back link.
 */
export default function MobileOpnameLanding() {
  return (
    <div className="space-y-6">
      <Link
        href="/m"
        className="inline-flex items-center gap-2 text-sm text-mahakan-green-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke menu
      </Link>

      <header className="flex flex-col items-start gap-2">
        <div className="flex size-14 items-center justify-center rounded-xl bg-mahakan-green-100 text-mahakan-green-800">
          <PackageSearch className="size-7" aria-hidden />
        </div>
        <h1 className="text-xl font-bold text-mahakan-green-900">
          Stock Opname
        </h1>
        <p className="text-sm text-neutral-700">
          Hitung stock fisik bahan per section, submit ke owner untuk
          verifikasi adjustment.
        </p>
      </header>

      <div className="rounded-xl border border-warning-300 bg-warning-100 p-4">
        <div className="flex items-start gap-3">
          <Wrench className="mt-0.5 size-5 shrink-0 text-warning-500" aria-hidden />
          <div>
            <p className="text-sm font-bold text-warning-500">
              Modul belum siap
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              Stock opname mobile lagi disiapkan. Sementara, opname dilakukan
              via Back Office tablet:
            </p>
            <ol className="mt-2 ml-4 list-decimal space-y-0.5 text-xs text-neutral-700">
              <li>Login Back Office (Owner / Manager / Supervisor)</li>
              <li>
                Buka <strong>Inventory</strong> tab → <strong>Opname</strong>
              </li>
              <li>Pilih session aktif → input per section</li>
              <li>Submit untuk approval Owner</li>
            </ol>
          </div>
        </div>
      </div>

      <Link
        href="/m"
        className="block rounded-md border border-neutral-300 bg-white px-5 py-3 text-center text-base font-medium text-neutral-900 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
      >
        Pilih Modul Lain
      </Link>
    </div>
  );
}
