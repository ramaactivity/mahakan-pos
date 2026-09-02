-- Sesi AE-227 — LAPORAN KASIR LEPAS DARI INPUT DASHBOARD.
--
-- Arahan owner: "Apabila ada data pengeluaran apapun, jangan integrasi dengan
-- laporan kasir kedepannya. Soalnya data input manual dari dashboard langsung
-- mengurangi pada POS kasir, jadi laporan dari kasir jangan diganggu sama
-- dashboard perhitungannya."
--
-- Sebelum kolom ini tidak ada satu pun cara membedakan uang yang keluar dari
-- LACI KASIR versus uang yang dicatat dari back office (brankas / rekening
-- owner). Akibatnya setiap pengeluaran tunai yang diinput dari dashboard ikut
-- memotong "Kas Harusnya" saat kasir tutup shift DAN "Kas Tersedia" yang
-- dipakai kasir menentukan besar setoran — padahal uangnya masih utuh di laci.
--
--   'pos'        = keluar/masuk LACI KASIR (Petty Cash POS, refund POS)
--   'backoffice' = diinput dari dashboard; tidak pernah menyentuh laporan kasir
--   NULL         = baris lama sebelum sesi ini. Dibaca sebagai 'pos' supaya
--                  shift yang sudah tertutup tidak berubah surut — variance-nya
--                  sudah ter-persist dengan perhitungan lama. SENGAJA tidak
--                  di-backfill.
--
-- Additive murni: dua kolom nullable, tanpa default, tanpa constraint. Tidak
-- ada satu baris pun yang tersentuh.

ALTER TABLE "expenses" ADD COLUMN "entry_origin" text;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "entry_origin" text;
