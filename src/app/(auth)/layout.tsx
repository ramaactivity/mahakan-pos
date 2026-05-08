import Image from "next/image";
import type { ReactNode } from "react";
import { AuthPathSwitcher } from "@/features/auth/AuthPathSwitcher";

/**
 * Auth shell — sesi AD-6b redesign.
 *
 * Galaxy A7 Lite landscape (1340×800, target device) awalnya stuck di
 * single-column karena `lg:` (1024px) tidak konsisten trigger di Chrome
 * Android tablet. Switched ke `landscape:md:` (orientation landscape +
 * ≥768px) yang reliably matches the device.
 *
 * Trigger logic:
 *   landscape + ≥768 → split 2-col (tablet landscape, desktop)
 *   portrait OR <768 → stacked single col (phone, tablet portrait)
 *
 * Compact-fit budget Galaxy A7 Lite landscape (1340×800):
 *   - Total available height ~800px (PWA full-screen) or ~720px (with
 *     Chrome chrome). Layout MUST fit within 720px to be safe.
 *   - LEFT col 5fr (~558px wide): logo + brand + switcher + tagline
 *   - RIGHT col 7fr (~782px wide): card content (avatar grid OR PIN
 *     entry OR email form)
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full overflow-hidden bg-gradient-to-br from-mahakan-green-50/40 via-neutral-50 to-white">
      <div className="grid h-svh w-full grid-cols-1 landscape:md:grid-cols-[5fr_7fr]">
        {/* ============================================================ */}
        {/* LEFT — Brand + workspace switcher                            */}
        {/* ============================================================ */}
        <aside className="relative flex flex-col items-start gap-3 px-4 py-4 sm:px-6 landscape:md:gap-5 landscape:md:px-8 landscape:md:py-6 lg:px-12 lg:py-8 xl:px-16">
          {/* Subtle decorative bloom — only on roomy viewports (xl+) */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 hidden size-96 rounded-full bg-mahakan-green-200/30 blur-3xl xl:block"
          />

          {/* Logo + brand mark — compact horizontal on landscape tablet,
              taller stacked layout on desktop */}
          <div className="relative flex w-full items-center gap-3 landscape:md:gap-3 lg:flex-col lg:items-start lg:gap-4">
            <Image
              src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
              alt="Mahakan Coffee & Space"
              width={120}
              height={170}
              priority
              className="h-10 w-auto landscape:md:h-12 lg:h-16 xl:h-20"
            />
            <div className="lg:space-y-1">
              <h1 className="text-base font-bold leading-tight text-mahakan-green-900 landscape:md:text-lg lg:text-2xl xl:text-3xl">
                Mahakan
              </h1>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600 landscape:md:text-[11px] lg:text-xs">
                Coffee &amp; Space
              </p>
            </div>
          </div>

          {/* Workspace switcher */}
          <div className="relative w-full max-w-md landscape:md:max-w-sm">
            <AuthPathSwitcher />
          </div>

          {/* Tagline — only on lg+ as fill (tablet landscape too tight) */}
          <div className="relative hidden flex-1 flex-col justify-end gap-2 lg:flex">
            <p className="max-w-xs text-sm leading-relaxed text-neutral-700">
              Sistem POS &amp; back office Mahakan Coffee &amp; Space.
              Login pakai PIN buat kasir cepat, atau email buat manage
              dari mana aja.
            </p>
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">
              Cisarua, Bogor · Phase 1
            </p>
          </div>
        </aside>

        {/* ============================================================ */}
        {/* RIGHT — Card content                                         */}
        {/* ============================================================ */}
        <main className="flex w-full items-center justify-center overflow-y-auto px-4 py-4 sm:px-6 landscape:md:px-6 landscape:md:py-4 lg:px-10 lg:py-6 xl:px-16">
          <div className="w-full max-w-md landscape:md:max-w-2xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
