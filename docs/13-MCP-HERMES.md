# 13 — MCP untuk Hermes (agent `mahakan`), fase 1: baca saja

Untuk sesi Claude di repo HERMES. Pola sama dengan Tetra Ops (`/api/mcp`, JSON-RPC stateless, tanpa SDK), jadi konfigurasi MCP Hermes cukup disalin dan diganti URL + key.

## 1. Endpoint

- **URL production:** `https://mahakan-pos.vercel.app/api/mcp` (aktif setelah Rama mengizinkan deploy; per 24 Sep 2026 BELUM di-deploy).
- Transport: Streamable HTTP tanpa sesi. Hanya `POST`; `GET` → 405 (sesuai probe Hermes).
- Method: `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/*` (→ 202).
- Kode: `src/app/api/mcp/route.ts`, `src/features/mcp/protocol.ts`, `src/features/mcp/tools.ts`.

## 2. Auth

- Header `Authorization: Bearer <MAHAKAN_MCP_API_KEY>`. Dibandingkan timing-safe (sha256 + `timingSafeEqual`).
- Tanpa key, key salah, atau env belum diset → **401** (tidak ada pengecualian mode dev).
- 10 kali gagal per IP dalam 15 menit → **429** (`src/lib/rate-limit.ts`, per instance serverless).
- Key ini setara akses owner (HPP, laba, saldo). Hanya untuk agent owner.

**Cara memasang key (Rama):**
1. Buat key: `openssl rand -base64 32`.
2. Vercel → project mahakan-pos → Settings → Environment Variables → tambah `MAHAKAN_MCP_API_KEY` (Production), lalu redeploy.
3. Salin nilai yang sama ke `~/Desktop/HERMES/.env.local`, dengan nama variabel yang dipakai konfigurasi MCP profil `mahakan` (ditentukan sesi Hermes). Jangan tempel key di chat, dokumen, atau commit.

## 3. Tool (semua `readOnlyHint: true`)

Semua respons punya `periode` dan `dihitung_pada` (ISO WIB). Rupiah integer, tanggal `YYYY-MM-DD` WIB. Error → `{"error":"<pesan>"}` dengan `isError: true`. Ukuran = uji ke data produksi 24 Sep 2026.

| Tool | Argumen (default) | Sumber angka (fungsi yang dipakai layar) | Contoh (dipotong) | Ukuran |
|---|---|---|---|---|
| `ringkasan_harian` | `tanggal` (hari ini) | `fetchDailySalesReport`, `fetchClosingShiftReport`, `fetchLowStockIngredients`, `peringatan` | `{"omzet":750000,"transaksi":14,"persen_target":50,"teks":"Mahakan 2026-09-23\nOmzet Rp 750.000…"}` | 0,6–1,1 rb |
| `pencapaian_target` | `periode` hari/minggu/bulan, `tanggal` | `fetchSalesRangeReport` + `resolveMonthlyTarget` (kartu Target dashboard) | `{"realisasi":17117000,"target":40000000,"persen":42.8,"sisa_hari":6,"butuh_per_hari":3813834}` | ~0,25 rb |
| `penjualan_produk` | `dari`, `sampai` (hari ini), `urut` omzet/qty/margin/terendah, `limit` 10 | `fetchItemPerformance` (+ `fetchMenuItems` untuk yang tak laku) | `{"produk":[{"produk":"Pablo Eskopi","qty":86,"omzet":2064000,"hpp":841510,"margin_persen":59}]}` | 0,4–1,0 rb |
| `laba_rugi` | `bulan` (bulan berjalan) | `getAccountBalances(excludeClosingEntries)` + `buildIncomeStatement` (Akuntansi → Laba Rugi) | `{"pendapatan_bersih":32022000,"hpp":13495982,"laba_bersih":2338784,"bulan_lalu":{…}}` | ~0,5 rb |
| `stok_menipis` | `limit` 10 | `fetchLowStockIngredients` (Inventori) | `{"jumlah":70,"bahan":[{"nama":"Bawang Merah","sisa":72,"batas":100,"satuan":"gr","supplier":"Pasar Cisarua"}]}` | ~1,1 rb |
| `hutang` | `status` belum_lunas/telat, `limit` 10 per kelompok | `listCreditors`, `fetchTopOutstanding`, `listInternalDebtParties` | `{"kreditur":{"total":25000000,"jumlah":36,…},"hutang_dagang":{…},"hutang_internal":{…}}` | 0,2–1,3 rb |
| `jatuh_tempo` | `hari_ke_depan` 7 (maks 90) | sama dengan `hutang` | `{"daftar":[{"jenis":"hutang_dagang","pihak":"Ibu Cucu Dimsum","jumlah":300000,"sisa_hari":3}]}` | ~0,35 rb |
| `saldo_kas` | — | `getAccountBalances` (Neraca, akun 110x/111x/112x) + `getCashOnHand` | `{"akun":[{"akun":"BANK BNI","saldo":10583892}],"kas_fisik_belum_disetor":15120500}` | ~0,7 rb |
| `pengeluaran` | `dari` (awal bulan), `sampai`, `kategori` | `fetchPnlReport` per kategori + `fetchExpenses` | `{"total":15666076,"per_kategori":[…],"terbesar":[…5]}` | ~0,9 rb |
| `peringatan` | — | lihat di bawah | `{"peringatan":[]}` | ~0,1 rb |

Rata-rata ±650 karakter. Terbesar `hutang` default (1,3 rb).

**`peringatan` hanya memuat:**
- shift belum ditutup setelah hari berganti (tangga rem POS AE-217, level soft/hard);
- selisih kas shift kemarin/hari ini di atas ambang (`thresholds.shiftVarianceAlert`, sekarang Rp 10.000);
- anomali void/refund/compliment level warning/danger (`fetchRefundVoidComplimentReport`);
- approval koreksi/rebalance/ubah-entri yang menunggu;
- purchase request `open` lebih dari 3 hari;
- `journal_retry_queue` yang belum selesai lebih dari 2 jam;
- stok habis (hanya kalau mode stok perpetual; sekarang periodik, jadi tidak aktif).

Daftar kosong = Hermes diam.

## 4. Jam laporan harian

**07:00 WIB, `ringkasan_harian` dengan `tanggal` = kemarin.** Alasannya:
- akhir pekan tutup 23:00 dan sekitar sepertiga shift lewat tengah malam;
- POS dipaksa tutup shift paling lambat 01:00;
- settlement QRIS/EDC jalan 01:05.

Laporan pukul 23:xx belum final. `peringatan` untuk tanggal kemarin/hari ini sudah ikut di field `perhatian`.

## 5. Notifikasi yang sudah ada di aplikasi (web push)

Semua jam dalam WIB.

**Terjadwal:**
- 01:05 settlement cashless (tanpa push)
- 06:05 absensi pagi
- 08:05 stok rendah
- 20:05 setoran menunggu verifikasi
- 21:05 checklist closing
- Minggu 19:05 checklist mingguan
- Tanggal 28 pukul 10:05 checklist bulanan
- Tiap run cron (11 kali/hari): sapuan jurnal

**Berbasis kejadian:**
- selisih kas ≥ Rp 50.000 saat tutup shift
- PR baru
- setoran baru
- payroll di-finalize
- jurnal gagal

Rincian ada di `docs/PENGETAHUAN-AGENT-MAHAKAN.md`. Hermes jangan mengulang hal-hal ini tanpa ditanya.

## 6. Hasil uji

| Perintah | Hasil |
|---|---|
| `npx vitest run src/features/mcp` | 16/16 lulus: protokol, auth 401/429, semua tool terdaftar read-only, angka diteruskan apa adanya dari fungsi laporan, target bulan pakai target terkunci, laba rugi = income statement tanpa closing entry, `limit` default 10 dan maks 50, `peringatan` kosong saat aman |
| `npx vitest run` (semua) | 132 file, 2024 tes lulus |
| `npm run typecheck` | lulus |
| `npx eslint src/features/mcp src/app/api/mcp` | bersih. Catatan: `eslint .` di seluruh repo masih error di file lama yang tidak disentuh (skrip `_oneshot`, beberapa komponen admin). |
| Semua tool dipanggil lewat handler ke DB produksi (baca saja): `scripts/_oneshot/cek-mcp-tools.ts` | 10 tool jalan, semua < 1.500 karakter, argumen salah → error singkat |
| Omzet target dicocokkan dengan SQL kartu dashboard | 1–24 Sep 17.117.000, 7 hari 4.992.000, 23 Sep 750.000: **sama persis** |
| `next dev` lokal + curl | tanpa key 401, key salah 401, GET 405, `tools/list` 10 tool `readOnlyHint: true`, `ringkasan_harian` 23 Sep sesuai di atas |

**Belum jalan:** uji curl ke production. Menunggu izin deploy dan key diset di Vercel. Angka `ringkasan_harian` perlu dicocokkan manual bersama Rama di halaman Laporan.

## 7. Keputusan yang menunggu Rama

1. Izin commit + deploy (`release/phase-1`) dan pembuatan `MAHAKAN_MCP_API_KEY` di Vercel.
2. **Minggu = 7 hari bergulir**, mengikuti kartu dashboard, jadi tidak ada "sisa hari minggu ini". Kalau mau Senin–Minggu, angkanya akan beda dari dashboard.
3. Target harian/mingguan tidak punya riwayat; tanggal lampau dinilai dengan target sekarang (tool memberi `catatan`).
4. `stok_menipis` mengikuti layar Inventori. Dalam mode periodik, sisanya adalah hasil opname terakhir, sehingga 70 bahan tampil menipis. Karena itu tidak ada "perkiraan habis", dan "stok habis" tidak masuk `peringatan`.
5. Data belum tersedia di aplikasi, jadi tidak dikarang: tagihan rutin (sewa/listrik/internet) dan jadwal bagi hasil investor tidak masuk `jatuh_tempo`; purchase request tidak punya status "menunggu approval", jadi dipakai "open > 3 hari".
6. `saldo_kas` menampilkan Bank BRI −10,4 jt dan BCA −1,1 jt. Ini sama dengan Neraca dan disebabkan koreksi gaji Mei–Juli yang belum dikerjakan (lihat catatan AE-210).

## 8. Usulan tool baru (belum dibuat)

- `bagi_hasil_investor(bulan?)`: laba yang dibagi, porsi investor 35%, status distribusi.
- `kehadiran_karyawan(tanggal?)`: siapa masuk, telat, belum absen.
- `rekap_belanja(dari, sampai)`: belanja bahan per section/supplier (dari fungsi Rekap Belanja AE-222).

## 9. Usulan fase 2 (jangan dikerjakan dulu)

Tool tulis dengan pola Tetra Ops:
1. `<nama>_usulan` hanya pratinjau (`readOnlyHint: true`).
2. Owner menyetujui ringkasannya.
3. Baru `<nama>` dipanggil dengan `konfirmasi: true` (`readOnlyHint: false`). Server menolak tanpa konfirmasi, mencatat pelaku (owner), dan menulis audit log.

Kandidat:
- `catat_pengeluaran`
- `approve_purchase_request`
- `tandai_hutang_lunas`
- `verifikasi_setoran`

Handler `protocol.ts` sekarang sengaja hanya mendukung tool baca. Cabang `_usulan`/`konfirmasi` disalin dari Tetra `src/lib/ai/mcp.ts` saat fase 2 dimulai.
