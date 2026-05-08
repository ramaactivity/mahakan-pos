import Image from "next/image";
import type { ReactNode } from "react";
import { AuthPathSwitcher } from "@/features/auth/AuthPathSwitcher";

/**
 * Auth shell — sesi AD-5 redesign per staff feedback.
 *
 * Old layout was vertically stacked (logo → switcher → card) inside
 * max-w-md. On Galaxy A7 Lite landscape (1340×800) the avatar grid
 * 3×3 + workspace switcher + logo header overflowed the 800px
 * viewport, forcing scroll.
 *
 * New layout: side-by-side on `lg:` and up (≥1024px catches A7 Lite
 * 1340 landscape + desktop), single-column stacked below `lg:` (phone
 * portrait + tablet portrait).
 *
 *   LEFT (5fr): branding hero + workspace switcher + brand footer
 *   RIGHT (7fr): card content (avatar select / PIN entry / email form)
 *
 * `min-h-svh` accounts for iOS Safari URL-bar trap. Subtle radial
 * decoration in left column gives the "kiosk" feel without being
 * shouty.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full overflow-hidden bg-gradient-to-br from-mahakan-green-50/40 via-neutral-50 to-white">
      <div className="grid w-full grid-cols-1 lg:grid-cols-[5fr_7fr]">
        {/* ============================================================ */}
        {/* LEFT — Brand + workspace switcher                            */}
        {/* ============================================================ */}
        <aside className="relative flex flex-col items-center gap-6 px-6 py-8 lg:items-start lg:gap-8 lg:px-12 lg:py-12 xl:px-16">
          {/* Decorative brand bloom — only on lg+ to avoid clutter on phone */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 hidden size-96 rounded-full bg-mahakan-green-200/40 blur-3xl lg:block"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-32 hidden size-80 rounded-full bg-mahakan-green-100/40 blur-3xl lg:block"
          />

          {/* Logo + brand mark */}
          <div className="relative flex w-full items-center gap-3 lg:flex-col lg:items-start lg:gap-4">
            <Image
              src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
              alt="Mahakan Coffee & Space"
              width={120}
              height={170}
              priority
              className="h-12 w-auto lg:h-20"
            />
            <div className="lg:space-y-1">
              <h1 className="text-base font-bold leading-tight text-mahakan-green-900 lg:text-3xl">
                Mahakan
              </h1>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-600 lg:text-xs">
                Coffee &amp; Space
              </p>
            </div>
          </div>

          {/* Workspace switcher */}
          <div className="relative w-full max-w-md lg:max-w-sm">
            <AuthPathSwitcher />
          </div>

          {/* Tagline — only on lg+ as fill */}
          <div className="relative hidden flex-1 flex-col justify-end gap-3 lg:flex">
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
        <main className="flex w-full items-center justify-center px-4 py-6 sm:px-6 lg:px-12 lg:py-10 xl:px-16">
          <div className="w-full max-w-md lg:max-w-2xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
