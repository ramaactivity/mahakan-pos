import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-8 text-center">
      <Image
        src="/assets/logo/Logo_Mahakan_Putih.png"
        alt="Mahakan Coffee & Space"
        width={96}
        height={136}
        priority
        className="mix-blend-difference"
      />
      <h1 className="mt-6 text-2xl font-bold text-mahakan-green-900">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 max-w-sm text-sm text-neutral-600">
        URL yang kamu buka tidak ada. Mungkin link sudah berubah atau salah
        ketik.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-mahakan-green-700 px-5 text-sm font-medium text-white transition-colors hover:bg-mahakan-green-800 active:bg-mahakan-green-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2"
      >
        Kembali ke beranda
      </Link>
    </main>
  );
}
