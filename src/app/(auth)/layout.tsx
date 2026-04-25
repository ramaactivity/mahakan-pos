import Image from "next/image";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="mb-8 flex flex-col items-center">
        <Image
          src="/assets/logo/Logo_Mahakan_Hijau.png"
          alt="Mahakan Coffee & Space"
          width={120}
          height={170}
          priority
        />
        <p className="mt-3 text-sm text-neutral-500">
          Mahakan Coffee &amp; Space — POS
        </p>
      </div>
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
