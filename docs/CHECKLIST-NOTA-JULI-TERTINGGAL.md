# Checklist — Nota Pembelian Juli 2026 yang Belum Diinput

Dibuat sesi AE-196 (11 Agustus 2026) dari perbandingan opname 30 Juni vs
31 Juli 2026 di database produksi.

## Kenapa daftar ini ada

Stok fisik 16 bahan ini **naik** antara opname 30 Juni dan 31 Juli, padahal
nota pembeliannya tidak ada (atau qty-nya lebih kecil dari kenaikan). Barang
tidak bisa bertambah sendiri — berarti barangnya masuk tapi notanya belum
tercatat. Inilah yang membuat kolom **Pemakaian** di laporan Persediaan Bahan
Baku jadi minus.

Rumusnya: `Pemakaian = Stok Awal + Pembelian − Stok Akhir`. Kalau Pembelian
tercatat 0 padahal stok akhir lebih besar dari stok awal, hasilnya pasti minus.

## Cara menutup

Input notanya lewat **Inventory → Catat Pembelian**, dengan **tanggal nota
yang sebenarnya** (tanggal di struk/nota, bukan tanggal hari ini). Setelah
semua masuk, buka Laporan → Persediaan Bahan Baku periode Juli dan pastikan
tidak ada lagi baris minus.

Kalau notanya benar-benar hilang, jangan mengarang angka — catat sebagai
temuan dan biarkan minus, lalu jelaskan di catatan opname berikutnya.

## Daftar (urut nilai rupiah terbesar)

| # | Bahan | Satuan | Stok awal | Nota tercatat | Stok akhir | Kekurangan nota | Perkiraan nilai |
|---|---|---|---|---|---|---|---|
| 1 | Powder Red Velvet Denali | gr | 1,4 | 0 | 1.600 | 1.598,6 | Rp 260.575 |
| 2 | Struk Thermal | Pcs | 12 | 0 | 45 | 33 | Rp 46.200 |
| 3 | Minyak Ayam | ml | 115 | 0 | 1.000 | 885 | Rp 30.975 |
| 4 | Lychee Syrup Denali | ml | 1.500 | 0 | 1.700 | 200 | Rp 27.400 |
| 5 | Powder Tiramisu Denali | gr | 201,3 | 0 | 375,6 | 174,3 | Rp 25.099 |
| 6 | Spidol Whiteboard Snowman | Pcs | 2 | 0 | 5 | 3 | Rp 24.000 |
| 7 | Mango Syrup Sunquick | ml | 800 | 0 | 1.030 | 230 | Rp 23.000 |
| 8 | Plastik 1Kg | Pcs | 80 | 0 | 160 | 80 | Rp 10.000 |
| 9 | Mie | Pcs | 1 | 0 | 4 | 3 | Rp 6.999 |
| 10 | Garnish | gr | 0,3 | 0 | 29,9 | 29,6 | Rp 6.810 |
| 11 | Wijen 50Gr | gr | 100 | 50 | 200 | 50 | Rp 6.000 |
| 12 | Garpu Plastik | Pcs | 75 | 0 | 100 | 25 | Rp 5.000 |
| 13 | Kecap Ikan | ml | 270 | 0 | 320 | 50 | Rp 4.800 |
| 14 | Cinnamon Bubuk | gr | 40 | 0 | 72 | 32 | Rp 4.000 |
| 15 | Vanili | gr | 20 | 40 | 70 | 10 | Rp 3.500 |
| 16 | Sabun Cuci Piring Cargloss | ml | 75.000 | 0 | 76.000 | 1.000 | Rp 2.000 |
| | **TOTAL** | | | | | | **Rp 486.358** |

Baris 11 (Wijen) dan 15 (Vanili) notanya SUDAH ada sebagian — yang kurang
tinggal selisihnya saja, jangan diinput dobel.

## Catatan khusus dua bahan

**Powder Red Velvet Denali** — stok awalnya tercatat 1,4 gr karena hitungan
opname 30 Juni salah ketik (lihat di bawah). Nilai sebenarnya diperkirakan
1.381 gr. Jadi kekurangan notanya kemungkinan besar hanya sekitar 219 gr
(± 1 pack 800 gr yang dipakai sebagian), bukan 1.598 gr.

**Garnish** — hal serupa: tercatat 0,3 gr, kemungkinan besar aslinya 293 gr.
Kalau benar, Garnish justru tidak kekurangan nota sama sekali.

## Lima hitungan opname 30 Juni yang salah skala

Kolom hitungan opname membaca titik sebagai koma desimal, jadi ketikan
"1.381" tersimpan sebagai 1,381. Lima bahan kena, semuanya di sesi 30 Juni:

| Bahan | Tersimpan | Kemungkinan maksudnya |
|---|---|---|
| Powder Red Velvet Denali | 1,3810 gr | 1.381 gr |
| Cranberry Juice | 1,8831 ml | 1.883,1 ml |
| Wipping Cream Rich Gold | 1,3378 gr | 1.337,8 gr |
| Butterscoth Syrup | 0,9868 ml | 986,8 ml |
| Garnish | 0,2930 gr | 293 gr |

**Angka-angka ini sengaja TIDAK diubah.** Opname yang sudah disetujui terikat
ke kartu stok (`inventory_movements`), stok berjalan, dan jurnal penyesuaian
persediaan; mengubah angkanya langsung di database akan membuat ketiganya
tidak lagi cocok. Efeknya juga sudah saling menutup: Juni tercatat boros,
Juli tercatat minus, dan opname 31 Juli sudah mengembalikan stok ke angka
fisik yang benar. Yang perlu dikonfirmasi ke Anisa hanyalah apakah tebakan
di kolom kanan memang betul, untuk arsip.

Mulai sesi AE-196 kolom hitungan opname menolak diam: begitu staff mengetik
angka berpola ribuan atau pecahan tak wajar di satuan gram/ml, muncul
peringatan di bawah kolom sebelum tersimpan.
