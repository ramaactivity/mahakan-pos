import Link from "next/link";
import { ArrowLeft, ClipboardList, Wrench } from "lucide-react";

/**
 * Sesi AD-9 scaffold — Purchase Order mobile module placeholder.
 *
 * Full implementation deferred to next sesi (AD-10):
 *   - List low-stock ingredients (auto-suggest from stock threshold)
 *   - Add custom items with qty + unit
 *   - Submit to purchase_requests table (uses existing
 *     createPurchaseRequest action from sesi AC-3)
 *   - Generate WhatsApp deeplink to owner with pre-filled message
 *
 * For now: explainer + back link.
 */
export default function MobilePoLanding() {
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
          <ClipboardList className="size-7" aria-hidden />
        </div>
        <h1 className="text-xl font-bold text-mahakan-green-900">
          Purchase Order
        </h1>
        <p className="text-sm text-neutral-700">
          Buat permintaan belanja saat bahan menipis. Owner approve via
          WhatsApp, lalu Manager belanja.
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
              Purchase order mobile lagi disiapkan. Sementara, lo bisa pakai
              flow yang sudah ada:
            </p>
            <ol className="mt-2 ml-4 list-decimal space-y-0.5 text-xs text-neutral-700">
              <li>
                <strong>Saat tutup shift:</strong> kalau ada bahan low-stock,
                muncul prompt input belanja → owner dapat WhatsApp link
              </li>
              <li>
                <strong>Manual via Back Office:</strong> Inventory tab →
                Pembelian → Permintaan
              </li>
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
