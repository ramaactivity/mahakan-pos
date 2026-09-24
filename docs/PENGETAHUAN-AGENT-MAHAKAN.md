# Pengetahuan Bisnis — Agent Mahakan

Fakta yang tidak bisa diambil dari tool MCP. Angka live selalu ambil dari tool, jangan dari dokumen ini.

## Profil
- Mahakan Coffee & Space, satu outlet: Puncak Rd KM 22, Cisarua, Bogor. Semua waktu WIB.
- Jam buka: Senin–Jumat 14:00–22:00, Sabtu–Minggu 09:00–23:00. Tidak ada hari libur tetap di aplikasi. Libur nasional/cuti bersama: [TANYA RAMA].
- Shift kasir (template): hari kerja Shift 1 08–17, Shift 2 13–22; akhir pekan Shift 1 08–17, Shift 2 14–23. Satu shift terbuka per outlet.
- Shift sering lewat tengah malam (sekitar 1 dari 3 shift). Aplikasi mengingatkan tutup shift 23:30, memunculkan popup 00:00, dan mengunci POS 01:00.

## Peran
- Owner: Rama. Memutuskan harga, target, pembelian besar, bagi hasil, koreksi akuntansi. Satu-satunya penerima laporan agent.
- Manager (pengelola operasional), supervisor (kepala shift), staff/kasir (login PIN di tablet). Manager tidak melihat HPP/laba.
- Siapa pengelola dan finance saat ini, dan siapa yang memutuskan apa di luar Rama: [TANYA RAMA].

## Cara membaca angka
- Omzet = total transaksi lunas (paid + partially_refunded) dikurangi refund, sudah bersih dari diskon. Tidak ada pajak atau service charge di aplikasi.
- Tanggal transaksi = waktu transaksi dibuat (WIB). Penjualan setelah 00:00 masuk ke hari berikutnya walau shiftnya masih shift kemarin.
- Data satu hari dianggap final setelah shift terakhir ditutup (paling lambat 01:00 karena POS terkunci) dan settlement QRIS/EDC otomatis 01:05.
- HPP per produk = HPP menu yang tersimpan saat transaksi. Stok memakai mode periodik: stok hanya diperbarui saat opname, jadi "stok menipis" = hasil opname terakhir, bukan sisa real-time.
- Laba rugi (`laba_rugi`) diambil dari buku besar akuntansi. HPP bulan berjalan belum lengkap sampai opname akhir bulan dan tutup buku. Jangan simpulkan "rugi" dari bulan yang masih berjalan.
- Buku bersih mulai 1 Juli 2026. Data sebelum itu disembunyikan dari laporan keuangan, tetapi laporan penjualan tetap menampilkannya.
- Masalah data yang sudah diketahui, jangan dilaporkan sebagai anomali baru: saldo Bank BRI dan BCA minus karena gaji Mei–Juli tercatat keluar dari BCA dan sedang dikoreksi owner; sebagian piutang QRIS masih tercatat di BCA padahal cair ke BNI.

## Target yang berlaku
- Harian Rp 1.500.000, mingguan Rp 10.000.000, bulanan Rp 40.000.000, tahunan Rp 500.000.000.
- Target mingguan disimpan eksplisit dan dihitung 7 hari bergulir (hari ini + 6 hari sebelumnya), sama dengan kartu dashboard. Bukan Senin–Minggu.
- Target bulan lalu hanya dianggap resmi kalau sudah dikunci per bulan. Kalau tidak dikunci, tool memberi `catatan`; sampaikan ke Rama.

## Batas wajar
- Selisih kas per shift: di atas Rp 10.000 dianggap perlu dicek (ambang di pengaturan). Aplikasi sendiri mengirim push kalau selisih ≥ Rp 50.000.
- Void/refund: pakai deteksi anomali aplikasi (`peringatan`). Persen void/refund normal: [TANYA RAMA].
- Margin minimal per produk: [TANYA RAMA]. Sebagai konteks, sebagian besar menu bermargin 45–73%.

## Pemasok & kewajiban rutin
- Pemasok utama (Jul–Sep 2026, berdasarkan nilai belanja): Pasar Cisarua (belanja harian), Quali Roastery (biji kopi), CV Ricky Jaya, PT Badar Berkah Mandiri, PT Sukanda Jaya, Widad (ayam), PT Sariguna Primatirta (air). Siklus belanja: [TANYA RAMA].
- Gaji: dibayar sekali per bulan untuk bulan sebelumnya. Payroll Agustus dibayar 6 Sep. Tanggal gajian tetap: [TANYA RAMA].
- Sewa tempat Rp 600.000/bulan, dibayar sekitar tanggal 8–9 untuk bulan sebelumnya. Listrik & air, internet: tanggal tagihan [TANYA RAMA].
- Kreditur: kebanyakan jatuh tempo 31 Mei 2030. Hutang dagang ke supplier punya jatuh tempo per nota.
- Bagi hasil investor: 35% laba untuk kolam investor, dihitung per bulan. Jadwal pembayaran: [TANYA RAMA].
- Tagihan rutin dan jadwal bagi hasil belum tercatat sebagai jadwal di aplikasi, jadi `jatuh_tempo` belum mencakupnya.

## Notifikasi yang SUDAH dikirim aplikasi (web push) — jangan diulang
Cron (GitHub Actions, menit ke-5):
- 01:05 settlement QRIS/EDC otomatis (tanpa push).
- 06:05 attendance-morning: pengingat absensi (kategori Absensi).
- 08:05 low-stock-scan: "N bahan stok rendah" (Inventory).
- 20:05 daily-digest: setoran tunai menunggu verifikasi (Tutup Bulanan & Laporan).
- 21:05 checklist closing harian; Minggu 19:05 checklist mingguan; tanggal 28 pukul 10:05 checklist bulanan (Checklist Operasional).
- Tiap run cron (11x/hari): sapuan jurnal hilang; push hanya kalau ada yang diperbaiki/gagal.

Berbasis kejadian:
- Selisih kas ≥ Rp 50.000 saat tutup shift (Shift Kasir).
- Permintaan belanja (PR) baru (Inventory).
- Setoran tunai baru menunggu verifikasi (Setoran & Pembayaran).
- Payroll di-finalize (Payroll).
- Jurnal otomatis gagal (Sistem / Tutup Bulanan).

Push dikirim ke user yang berlangganan kategorinya. Siapa saja penerimanya: [TANYA RAMA].

## Jangan ganggu Rama soal
- Hal yang sudah dikirim push di atas, kecuali Rama bertanya.
- Hari tanpa masalah: `peringatan` kosong = diam.
- Masalah data yang sudah diketahui (lihat "Cara membaca angka").
- Jam tenang dan topik lain yang tidak ingin diganggu: [TANYA RAMA].
