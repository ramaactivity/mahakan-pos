/**
 * `npm run seed:accounts` — idempotent seed of 56 default Chart of Accounts
 * sesuai docs/10-ACCOUNTING-DESIGN.md §2.
 *
 * Code 4-digit sebagai natural key. Re-run safe — skips existing.
 *
 * 47 akun aktif sesi S-V. 5 akun fixed asset (1201-1204, 1290) + 4 akun
 * depresiasi (6501-6504) seeded sebagai is_active=false sampai sesi W
 * (Owner aktifkan kalau adopt fixed asset module).
 *
 * Owner can deactivate non-system accounts via UI. System accounts
 * (is_system=true) protected from deletion karena dipakai auto-journal hooks.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { outlets, chartOfAccounts, users } from "@/db/schema";
import { getBool, parseCliArgs } from "./_shared/cli-args";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
type NormalBalance = "debit" | "credit";

interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  parentCode?: string;
  isContra?: boolean;
  isSystem?: boolean;
  isActiveOnSeed?: boolean; // false untuk akun fixed asset (sesi W)
  notes?: string;
  displayOrder: number;
}

/**
 * 56 default accounts. Display order grouped per type, ascending dalam type.
 * System accounts (isSystem=true) wajib ada untuk auto-journal hooks sesi T+.
 */
const DEFAULTS: DefaultAccount[] = [
  // ============ 1xxx ASET — Aset Lancar ============
  { code: "1101", name: "Kas Tunai (Drawer POS)", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 1, notes: "Cash drawer aktif POS — open shift cash + verified deposit reconcile" },
  { code: "1102", name: "Kas Tunai (Brankas)", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 2, notes: "Cash on hand di luar drawer (idle, pending setor)" },
  /* Sesi AE-242 — uang muka kurir belanja pasar. Kodenya sengaja di rentang
   * kas & bank (11[01][0-9]) supaya Buku Kas memperlakukannya sebagai buku
   * tersendiri: saldonya = total top up − total belanja, tanpa mesin saldo
   * kedua yang harus dijaga agar tidak melenceng. */
  { code: "1103", name: "Saldo Kurir Daily Market", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 3, notes: "Sesi AE-242. Uang yang sudah ditransfer ke kurir tapi belum dibelanjakan." },
  { code: "1110", name: "Bank BCA", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 3, notes: "Rekening operasional utama" },
  { code: "1111", name: "Bank BRI", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 4, notes: "Rekening cadangan" },
  { code: "1112", name: "Bank Lain-lain", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: false, displayOrder: 5, notes: "Owner bisa tambah bank lain via UI" },
  { code: "1120", name: "Piutang QRIS", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 10, notes: "POS QRIS sale → settle T+1 ke bank" },
  { code: "1121", name: "Piutang EDC BCA", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 11, notes: "POS card_bca sale → settle T+1" },
  { code: "1122", name: "Piutang GoFood", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 12, notes: "Sale via GoFood channel → settle weekly" },
  { code: "1123", name: "Piutang GrabFood", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 13, notes: "Sale via GrabFood channel" },
  { code: "1124", name: "Piutang ShopeeFood", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 14, notes: "Sale via ShopeeFood channel" },
  { code: "1125", name: "Piutang EDC BNI", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 15, notes: "POS card_bni sale → settle T+1" },
  { code: "1126", name: "Piutang EDC Mandiri", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 16, notes: "POS card_mandiri sale → settle T+1" },
  { code: "1127", name: "Piutang EDC BRI", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 17, notes: "POS card_bri sale → settle T+1" },
  { code: "1128", name: "Piutang EDC Lainnya", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 18, notes: "POS card_other sale → settle T+1 (catch-all bank lain: HSBC, OCBC, dll)" },
  { code: "1130", name: "Piutang Karyawan (Kasbon)", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: false, displayOrder: 20, notes: "Manual entry untuk advance gaji karyawan" },
  { code: "1140", name: "Persediaan Bahan Baku — Kitchen", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 30, notes: "Mirror ingredients.section='kitchen' value (sum current_stock × cost_per_unit)" },
  { code: "1141", name: "Persediaan Bahan Baku — Bar", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 31, notes: "Mirror section='bar'" },
  { code: "1142", name: "Persediaan Bahan Pendukung", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 32, notes: "Mirror section IN ('supporting','cleaning')" },
  { code: "1150", name: "Biaya Dibayar Dimuka", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: false, displayOrder: 40, notes: "Manual entry — sewa prepaid, asuransi" },
  { code: "1155", name: "Piutang Kasbon Karyawan", type: "asset", normalBalance: "debit", parentCode: "1100", isSystem: true, displayOrder: 41, notes: "Sesi AE-209b. Auto-debit saat kasbon diberikan; auto-credit saat dicicil / dipotong gaji / di-forgive. Saldo = kasbon karyawan yang belum lunas." },

  // ============ 12xx Aset Tetap (placeholder, sesi W) ============
  { code: "1201", name: "Furniture & Peralatan Cafe", type: "asset", normalBalance: "debit", parentCode: "1200", isSystem: false, isActiveOnSeed: false, displayOrder: 50, notes: "Sesi W: capitalized purchase ≥ Rp 500k threshold" },
  { code: "1202", name: "Mesin & Peralatan Dapur", type: "asset", normalBalance: "debit", parentCode: "1200", isSystem: false, isActiveOnSeed: false, displayOrder: 51, notes: "Sesi W" },
  { code: "1203", name: "Peralatan Bar", type: "asset", normalBalance: "debit", parentCode: "1200", isSystem: false, isActiveOnSeed: false, displayOrder: 52, notes: "Sesi W" },
  { code: "1204", name: "Peralatan IT (POS, printer, tablet)", type: "asset", normalBalance: "debit", parentCode: "1200", isSystem: false, isActiveOnSeed: false, displayOrder: 53, notes: "Sesi W" },
  { code: "1290", name: "Akumulasi Penyusutan", type: "asset", normalBalance: "credit", parentCode: "1200", isContra: true, isSystem: false, isActiveOnSeed: false, displayOrder: 60, notes: "Kontra-asset, sesi W (depresiasi otomatis bulanan)" },
  /* Sesi AE-214 — revaluasi & penurunan nilai aset tetap. */
  { code: "1291", name: "Akumulasi Penurunan Nilai Aset", type: "asset", normalBalance: "credit", parentCode: "1200", isContra: true, isSystem: false, isActiveOnSeed: false, displayOrder: 61, notes: "Sesi AE-214: kontra-asset PSAK 48. Cr saat penurunan nilai diakui, Dr saat dipulihkan atau saat asetnya direvaluasi (metode eliminasi)." },

  // ============ 2xxx KEWAJIBAN ============
  { code: "2101", name: "Hutang Dagang (TOP Supplier)", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: true, displayOrder: 1, notes: "Auto-credit saat purchase TOP confirm; auto-debit saat mark-paid" },
  { code: "2102", name: "Hutang Gaji", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: false, displayOrder: 2, notes: "Phase 3 accrual (sesi R: skip — mark-paid langsung Dr Gaji Cr Bank)" },
  { code: "2110", name: "Hutang Pajak", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: false, displayOrder: 10, notes: "Placeholder Phase 3 (PPh Final UMKM 0.5% atau PPN)" },
  { code: "2120", name: "Pendapatan Diterima Dimuka", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: false, displayOrder: 20, notes: "Manual entry — event booking deposit, gift card" },
  /* Sesi AE-80 — Modal & Dividen v2. */
  { code: "2150", name: "Hutang Kreditur", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: true, displayOrder: 30, notes: "Hutang pinjaman ke kreditur (pemberi pinjaman non-equity). Cr saat creditor created; Dr saat cicilan pokok dibayar (creditor_repayments)." },
  { code: "2160", name: "Hutang Dividen Investor", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: true, displayOrder: 40, notes: "Saldo dividen yang sudah ke-credit ke investor tapi belum dicairkan. Cr saat distribution v2 posted (re-classify dari 3201 Prive); Dr saat withdrawal posted." },
  /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola). */
  { code: "2170", name: "Hutang Internal (Talangan)", type: "liability", normalBalance: "credit", parentCode: "2100", isSystem: true, displayOrder: 50, notes: "Sesi AE-180: Hutang ke owner/pengelola/orang dalam yang nalangin pengeluaran atau minjamin tunai (tanpa bunga). Cr saat entry talangan/pinjaman posted (internal_debt_entries); Dr saat cicilan dibayar (internal_debt_repayments). Pinjaman formal berbunga tetap pakai 2150 Hutang Kreditur." },

  // ============ 3xxx EKUITAS ============
  { code: "3101", name: "Modal Owner", type: "equity", normalBalance: "credit", parentCode: "3100", isSystem: true, displayOrder: 1, notes: "Setoran modal awal + tambahan setoran" },
  { code: "3201", name: "Prive Owner", type: "equity", normalBalance: "debit", parentCode: "3200", isContra: true, isSystem: true, displayOrder: 10, notes: "Penarikan Owner (kontra-equity, normal balance debit)" },
  { code: "3301", name: "Saldo Laba Ditahan", type: "equity", normalBalance: "credit", parentCode: "3300", isSystem: true, displayOrder: 20, notes: "Akumulasi laba rugi closed periods" },
  { code: "3302", name: "Laba Rugi Berjalan", type: "equity", normalBalance: "credit", parentCode: "3300", isSystem: true, displayOrder: 21, notes: "Net income period berjalan, auto-transfer ke 3301 saat period close" },
  /* Sesi AE-80 — Treasury stock untuk company buyback share investor. */
  { code: "3401", name: "Treasury Stock (Buyback Saham)", type: "equity", normalBalance: "debit", parentCode: "3400", isContra: true, isSystem: true, displayOrder: 30, notes: "Sesi AE-80: Kontra-equity. Dr saat outlet beli kembali share dari investor (share_transactions kind='company_buyback'). Mengurangi total ekuitas." },
  /* Sesi AE-214 — kenaikan revaluasi TIDAK boleh lewat laba rugi (labanya
   * belum terwujud, asetnya belum dijual), jadi mendarat di ekuitas sini. */
  { code: "3501", name: "Surplus Revaluasi Aset Tetap", type: "equity", normalBalance: "credit", parentCode: "3500", isSystem: false, isActiveOnSeed: false, displayOrder: 35, notes: "Sesi AE-214 (PSAK 16 par. 39-40): Cr saat nilai wajar aset naik; Dr saat aset yang sama turun nilainya kembali (sampai habis) sebelum sisanya jadi rugi." },

  // ============ 4xxx PENDAPATAN ============
  { code: "4101", name: "Penjualan Makanan", type: "revenue", normalBalance: "credit", parentCode: "4100", isSystem: true, displayOrder: 1, notes: "Sum subtotal items kategori makanan (ricebowl/bakmie/snack default)" },
  { code: "4102", name: "Penjualan Minuman", type: "revenue", normalBalance: "credit", parentCode: "4100", isSystem: true, displayOrder: 2, notes: "Sum subtotal items kategori minuman (coffee/non-coffee/manual brew/tea default)" },
  { code: "4103", name: "Penjualan Lain", type: "revenue", normalBalance: "credit", parentCode: "4100", isSystem: false, displayOrder: 3, notes: "Merchandise, kalau ada" },
  { code: "4104", name: "Penjualan via Aggregator", type: "revenue", normalBalance: "credit", parentCode: "4100", isSystem: true, displayOrder: 4, notes: "Sesi T: revenue dari GoFood/GrabFood/ShopeeFood — auto-credit saat aggregator settlement masuk (no per-order POS, no COGS attribution; P&L footnote)" },
  { code: "4110", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit", parentCode: "4100", isContra: true, isSystem: true, displayOrder: 10, notes: "Kontra-revenue. Dr saat discount applied (manual + promo + redeem points)" },
  { code: "4111", name: "Refund Penjualan", type: "revenue", normalBalance: "debit", parentCode: "4100", isContra: true, isSystem: true, displayOrder: 11, notes: "Kontra-revenue. Dr saat transaction refunded" },
  { code: "4201", name: "Pendapatan Lain-lain", type: "revenue", normalBalance: "credit", parentCode: "4200", isSystem: true, displayOrder: 20, notes: "Default fallback untuk incomes table kalau accountId tidak diset" },
  { code: "4202", name: "Pendapatan Sewa Ruang", type: "revenue", normalBalance: "credit", parentCode: "4200", isSystem: false, displayOrder: 21, notes: "Sesi AE-71 — customer sewa Mahakan untuk event (komunitas, fotografi, dll). Beda dengan 6201 Sewa Tempat (expense, Mahakan bayar landlord)." },
  { code: "4203", name: "Pendapatan Titip Jual", type: "revenue", normalBalance: "credit", parentCode: "4200", isSystem: false, displayOrder: 22, notes: "Sesi AE-71 — komisi/markup dari titip jual produk pihak ketiga (UMKM, dll)" },
  { code: "4204", name: "Pemulihan Rugi Penurunan Nilai Aset", type: "revenue", normalBalance: "credit", parentCode: "4200", isSystem: false, isActiveOnSeed: false, displayOrder: 23, notes: "Sesi AE-214 (PSAK 48 par. 117): Cr saat penurunan nilai yang dulu diakui dipulihkan, dan saat kenaikan revaluasi memulihkan rugi revaluasi yang pernah dibebankan. Dibatasi sebesar yang pernah diakui sebagai rugi." },
  { code: "4301", name: "Pendapatan Bunga Bank", type: "revenue", normalBalance: "credit", parentCode: "4300", isSystem: false, displayOrder: 30, notes: "Manual entry akhir bulan" },

  // ============ 5xxx HARGA POKOK PENJUALAN ============
  { code: "5101", name: "HPP — Makanan", type: "cogs", normalBalance: "debit", parentCode: "5100", isSystem: true, displayOrder: 1, notes: "Auto-debit per POS sale paid, sourced dari transaction_items.cogs filtered ke food category" },
  { code: "5102", name: "HPP — Minuman", type: "cogs", normalBalance: "debit", parentCode: "5100", isSystem: true, displayOrder: 2, notes: "Auto-debit per POS sale paid, drink category" },
  { code: "5103", name: "HPP — Lain", type: "cogs", normalBalance: "debit", parentCode: "5100", isSystem: false, displayOrder: 3, notes: "Merchandise COGS" },

  // ============ 6xxx BEBAN OPERASIONAL — 61xx Personalia ============
  { code: "6101", name: "Gaji Karyawan", type: "expense", normalBalance: "debit", parentCode: "6100", isSystem: true, displayOrder: 1, notes: "Auto-debit saat payroll mark-paid (sourced dari payroll_lines.baseSalary, sesi AC-2)" },
  { code: "6102", name: "Tunjangan & Bonus", type: "expense", normalBalance: "debit", parentCode: "6100", isSystem: true, displayOrder: 2, notes: "Auto-debit saat payroll mark-paid (sourced dari payroll_lines.bonus, sesi AC-2)" },
  { code: "6103", name: "Lembur", type: "expense", normalBalance: "debit", parentCode: "6100", isSystem: true, displayOrder: 3, notes: "Auto-debit saat payroll mark-paid (sourced dari payroll_lines.overtimePay, sesi AC-2)" },
  { code: "6104", name: "BPJS / Asuransi Karyawan", type: "expense", normalBalance: "debit", parentCode: "6100", isSystem: false, displayOrder: 4, notes: "Manual entry bulanan" },
  { code: "6105", name: "Potongan Karyawan", type: "expense", normalBalance: "credit", parentCode: "6100", isContra: true, isSystem: true, displayOrder: 5, notes: "Kontra-expense. Auto-credit saat payroll mark-paid (sum lateDeduction + otherDeductions, sesi AC-2). Mengurangi total beban gaji efektif." },

  // ============ 62xx Sewa & Utilitas ============
  { code: "6201", name: "Sewa Tempat", type: "expense", normalBalance: "debit", parentCode: "6200", isSystem: true, displayOrder: 10, notes: "Manual expense → mapped ke akun ini lewat selector" },
  { code: "6202", name: "Listrik", type: "expense", normalBalance: "debit", parentCode: "6200", isSystem: true, displayOrder: 11, notes: "Manual expense" },
  { code: "6203", name: "Air", type: "expense", normalBalance: "debit", parentCode: "6200", isSystem: true, displayOrder: 12, notes: "Manual expense" },
  { code: "6204", name: "Internet & Telepon", type: "expense", normalBalance: "debit", parentCode: "6200", isSystem: true, displayOrder: 13, notes: "Manual expense" },
  { code: "6205", name: "Gas (LPG)", type: "expense", normalBalance: "debit", parentCode: "6200", isSystem: true, displayOrder: 14, notes: "Manual expense" },

  // ============ 63xx Operasional Toko ============
  { code: "6301", name: "Bahan Pendukung (Cleaning/Packaging)", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 20, notes: "Manual atau via purchases dengan section='supporting'/'cleaning' kalau Owner treat as expense langsung" },
  { code: "6302", name: "Pemeliharaan & Perbaikan", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 21, notes: "Manual" },
  { code: "6303", name: "Transportasi & Pengiriman", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 22, notes: "Manual" },
  { code: "6304", name: "Marketing & Iklan", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: true, displayOrder: 23, notes: "Default destination compliment + manual marketing spend" },
  /* Sesi AE-145 — Inab finance: split "ATK & Cetak" jadi 3 akun terpisah. */
  { code: "6305", name: "ATK", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 24, notes: "Manual — alat tulis kantor (kertas HVS, pena, map, stapler, dll)" },
  { code: "6306", name: "Biaya Cetak", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 25, notes: "Manual — biaya cetak nota/banner/materi promosi (sesi AE-145 split dari 6305)" },
  { code: "6307", name: "Fotocopy Berkas", type: "expense", normalBalance: "debit", parentCode: "6300", isSystem: false, displayOrder: 26, notes: "Manual — fotocopy dokumen/berkas (perizinan, kontrak, dll). Sesi AE-145." },

  // ============ 64xx Channel & Payment ============
  { code: "6401", name: "Biaya Aggregator", type: "expense", normalBalance: "debit", parentCode: "6400", isSystem: true, displayOrder: 30, notes: "Auto-debit saat aggregator settlement masuk (fee component)" },
  { code: "6402", name: "Biaya QRIS / EDC (MDR)", type: "expense", normalBalance: "debit", parentCode: "6400", isSystem: true, displayOrder: 31, notes: "Auto-debit saat QRIS/EDC settlement reconcile (kalau ada fee field); else manual monthly recap" },
  { code: "6403", name: "Biaya Bank", type: "expense", normalBalance: "debit", parentCode: "6400", isSystem: false, displayOrder: 32, notes: "Manual — admin fee bank, transfer fee" },

  // ============ 65xx Penyusutan (sesi W placeholder) ============
  { code: "6501", name: "Beban Penyusutan Furniture", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 40, notes: "Sesi W" },
  { code: "6502", name: "Beban Penyusutan Peralatan Dapur", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 41, notes: "Sesi W" },
  { code: "6503", name: "Beban Penyusutan Peralatan Bar", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 42, notes: "Sesi W" },
  { code: "6504", name: "Beban Penyusutan Peralatan IT", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 43, notes: "Sesi W" },
  /* Sesi AE-214 — dua akun rugi yang sengaja DIPISAH: penurunan nilai (PSAK 48,
   * asetnya memang tidak lagi bernilai segitu) beda sebab dengan rugi revaluasi
   * (PSAK 16, harga pasarnya turun di bawah nilai buku setelah surplus habis). */
  { code: "6505", name: "Rugi Penurunan Nilai Aset Tetap", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 44, notes: "Sesi AE-214 (PSAK 48): Dr saat nilai terpulihkan aset < nilai tercatat. Lawannya 1291." },
  { code: "6506", name: "Rugi Revaluasi Aset Tetap", type: "expense", normalBalance: "debit", parentCode: "6500", isSystem: false, isActiveOnSeed: false, displayOrder: 45, notes: "Sesi AE-214 (PSAK 16 par. 40): Dr sisa penurunan revaluasi setelah surplus revaluasi aset yang sama habis terpakai." },

  // ============ 66xx CSR & Sosial (sesi AE-63 phase4) ============
  /* Sesi AE-63 phase4 — staff finance request: "Request penambahan akun
   * pada beban untuk: Sumbangan sosial, Corporate Social Responsibility
   * Expense". Conceptually distinct dari operational store costs (63xx)
   * + payment fees (64xx) → group sendiri 66xx. */
  { code: "6601", name: "Sumbangan Sosial", type: "expense", normalBalance: "debit", parentCode: "6600", isSystem: false, displayOrder: 45, notes: "Manual entry — donasi ke yayasan/komunitas/individual yang tidak terkait promosi" },
  { code: "6602", name: "Beban CSR (Corporate Social Responsibility)", type: "expense", normalBalance: "debit", parentCode: "6600", isSystem: false, displayOrder: 46, notes: "Manual entry — program CSR (mis. coffee for kids, neighbour outreach), beda dengan marketing yang track ROI" },

  // ============ 67xx BEBAN KEUANGAN ============
  /* Sesi AE-80 — Beban bunga ke kreditur. Dr saat creditor_repayments
   * posted dengan interestAmount > 0. */
  { code: "6701", name: "Beban Bunga Kreditur", type: "expense", normalBalance: "debit", parentCode: "6700", isSystem: true, displayOrder: 47, notes: "Sesi AE-80: Auto-debit saat creditor_repayment posted (interest portion). Beda dengan pokok yang Dr 2150 Hutang Kreditur." },

  // ============ 69xx Lain-lain ============
  { code: "6901", name: "Lain-lain", type: "expense", normalBalance: "debit", parentCode: "6900", isSystem: true, displayOrder: 50, notes: "Default fallback untuk expense tanpa akun explicit" },
  { code: "6902", name: "Selisih Kas (Variance Shift)", type: "expense", normalBalance: "debit", parentCode: "6900", isSystem: true, displayOrder: 51, notes: "Auto-debit/credit saat shift close dengan variance != 0" },
  { code: "6903", name: "Penghapusan Persediaan (Opname Loss)", type: "expense", normalBalance: "debit", parentCode: "6900", isSystem: true, displayOrder: 52, notes: "Auto-debit saat opname finalize dengan shortage; surplus → reversal" },
];

async function main() {
  const args = parseCliArgs();
  const apply = getBool(args, "apply");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Resolve outlet (single-outlet)
  const outletRows = await db
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(isNull(outlets.deletedAt));
  if (outletRows.length === 0) throw new Error("No outlet found");
  if (outletRows.length > 1) throw new Error("Multi-outlet not handled");
  const outletId = outletRows[0].id;

  // Actor
  let actorId: string | null = null;
  const email = process.env.SEED_OWNER_EMAIL;
  if (email) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    actorId = u?.id ?? null;
  }

  console.log(`Mode:    ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Outlet:  ${outletRows[0].name} (${outletId})`);
  console.log(`Actor:   ${actorId ?? "(none)"}\n`);

  let toInsert = 0;
  let skipped = 0;

  for (const def of DEFAULTS) {
    const existing = await db
      .select({ id: chartOfAccounts.id, name: chartOfAccounts.name })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.outletId, outletId),
          eq(chartOfAccounts.code, def.code),
          isNull(chartOfAccounts.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    toInsert++;
    console.log(`  ADD:  ${def.code} ${def.name} (${def.type}, ${def.normalBalance}${def.isSystem ? ", system" : ""}${def.isContra ? ", contra" : ""}${def.isActiveOnSeed === false ? ", inactive" : ""})`);
    if (apply) {
      await db.insert(chartOfAccounts).values({
        outletId,
        code: def.code,
        name: def.name,
        type: def.type,
        normalBalance: def.normalBalance,
        parentCode: def.parentCode ?? null,
        isContra: def.isContra ?? false,
        isSystem: def.isSystem ?? false,
        isActive: def.isActiveOnSeed !== false,
        displayOrder: def.displayOrder,
        notes: def.notes ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      });
    }
  }

  console.log(
    `\n${apply ? "Applied" : "Plan"}: insert=${toInsert} skip=${skipped} total=${DEFAULTS.length}`,
  );
  if (!apply) {
    console.log("Re-run with --apply to commit.");
  }

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
