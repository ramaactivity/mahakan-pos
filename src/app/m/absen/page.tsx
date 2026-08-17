import type { Metadata } from "next";
import { AttendanceShell } from "@/features/attendance-mobile/AttendanceShell";

export const metadata: Metadata = {
  title: "Absensi — Mahakan Staff",
};

/**
 * Sesi AE-200 — absensi versi DI DALAM cakupan aplikasi Mahakan Staff.
 *
 * Kenapa route ini ada padahal /absenkaryawan sudah jalan:
 *   manifest staff punya `"scope": "/m"`. Kartu "Absensi" di beranda
 *   /m dulu menunjuk ke /absenkaryawan yang ADA DI LUAR cakupan itu,
 *   jadi saat dibuka dari ikon aplikasi terpasang, halamannya melompat
 *   ke browser-dalam-aplikasi (Custom Tab di Android, tampilan browser
 *   bawaan di iOS). Di sana izin kamera tersimpan terpisah dari izin
 *   yang sudah diberikan staff, sehingga getUserMedia sering gagal →
 *   komponen selfie jatuh ke kamera bawaan HP → foto tanpa EXIF →
 *   ditolak "kemungkinan upload galeri". Persis keluhan yang dilaporkan.
 *
 *   Dengan route ini, absen dari aplikasi terpasang tetap di dalam
 *   cakupan: satu browser, satu izin kamera, tidak ada lompatan.
 *
 * /absenkaryawan sengaja DIPERTAHANKAN — tautan itu sudah tersebar ke
 * staff dan tetap sah dibuka lewat Chrome/Safari biasa.
 */
export default function MobileAbsenPage() {
  /* Layout /m memberi padding container-nya sendiri; AttendanceShell sudah
   * punya padding + max-width sendiri, jadi netralkan supaya tidak dobel. */
  return (
    <div className="-mx-4 -my-6 sm:-my-8">
      <AttendanceShell />
    </div>
  );
}
