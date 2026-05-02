# 📒 ACCOUNTING DESIGN — Mahakan Coffee & Space

**Document:** Accounting / General Ledger Design Spec
**Version:** 1.0 — Phase 2 Tier (post-Finance/Keuangan module sesi Q)
**Date:** 2026-05-02 (sesi R)
**Status:** 🟢 DESIGN APPROVED — implementation across sesi S–V (target close akhir sesi V)
**Depends on:** `01-PRD.md`, `06-DATABASE-SCHEMA.md`, `99-PHASE-2-ROADMAP.md`
**Supersedes:** PRD §1.4 line 37 (`❌ Full double-entry accounting`) for Phase 2 tier — Phase 1 lock tetap berlaku sampai cutover

---

## 0. Heads-Up Singkat

PRD Phase 1 melarang double-entry accounting. Phase 1 ditutup. Phase 2 Tier 1.1 (Recipe/BOM), 1.2 (cost engine), 1.3 (Loyalty), Tier 2 partial (HR, Promo, Suppliers/Purchases, Stock Opname), dan **sesi Q Finance/Keuangan module** udah deploy. Yang ada sekarang = single-entry: tabel transactions/expenses/incomes/cash_deposits/aggregator_settlements/payroll dipakai langsung untuk reporting.

Dokumen ini mendesain **layer ledger paralel double-entry** di atas data existing — bukan ganti, tambahan. Sumber kebenaran cash flow operasional (Finance views sesi Q) tetap pakai tabel transaksional langsung sampai ledger live + tervalidasi 1-2 minggu, baru migrate.

---

## 1. Scope

### 1.1 In-Scope (sesi S–V)

- **Chart of Accounts (COA)** — ~52 akun, 4-digit code, struktur PSAK-friendly UMKM
- **Journal Entries + Journal Lines** — header + detail, debit/credit, must balance
- **Accounting Periods** — monthly buckets, state machine (open / closed / locked)
- **Auto-journal hooks** — POS sale/refund/compliment, purchase confirm/pay/cancel, payroll mark-paid, expense create, income create, cash deposit verified, aggregator settlement, shift cash variance, opname adjustment
- **Manual journal entry** — Owner-only dengan PIN gate, draft → post → reverse
- **Reports** — Trial Balance, General Ledger per akun, Income Statement (Laba Rugi), Balance Sheet (Neraca)
- **Period close logic** — monthly, lock entries, transfer net income ke Saldo Laba (closing entry)
- **RBAC + Audit** untuk semua action accounting
- **Cutover 1 Juni 2026** — Owner input "Jurnal Pembukaan" untuk saldo awal; pre-cutover transactions tidak di-journal

### 1.2 Out-of-Scope (Phase 3+ atau later)

- ❌ Tax compliance (PPN, PPh Final UMKM 0.5%) — skip, Owner konsultasi accountant terpisah
- ❌ Multi-currency — IDR only
- ❌ Multi-outlet consolidation — single outlet, schema multi-outlet ready saja
- ❌ Fixed asset module + monthly depreciation — opsional sesi W kalau Owner mau (akun 12xx + 65xx + 1290 udah disiapkan di COA tapi tidak di-auto-post sesi R-V)
- ❌ Audit-grade controls (segregation of duties beyond RBAC, immutable backup, etc) — defer
- ❌ Bank statement import + auto-reconciliation — defer (sesi Q udah punya manual reconciliation untuk aggregator)
- ❌ Backfill journal historis (April-Mei 2026) — pre-cutover akses via reports lama
- ❌ Budget vs actual variance reporting

### 1.3 Decisions Locked (D56–D60)

| ID | Decision | Rationale |
|---|---|---|
| **D56** | Basis akuntansi = **hybrid**: accrual untuk POS sales (revenue saat sale, piutang ke akun channel sampai settle), TOP purchase (hutang dagang sampai bayar), payroll (akrual bulanan via expense auto-create); cash basis untuk operasional kecil (sewa, listrik, internet — recorded saat keluar uang) | Selaras dengan struktur tabel existing (sourceType enum di expenses, settle lifecycle di aggregator_settlements + cash_deposits). Operasional kecil tidak ada lag signifikan |
| **D57** | COA detail level = **standard ~52 akun**, 4-digit code (1xxx aset / 2xxx kewajiban / 3xxx ekuitas / 4xxx pendapatan / 5xxx HPP / 6xxx beban) | UMKM kafe single-outlet — minimal 30 terlalu kasar (gak bisa pisah penjualan makanan vs minuman; biaya aggregator vs MDR), 100+ overwhelming. 52 = enough granularity untuk decision making tanpa ngerepotin Owner |
| **D58** | Backfill = **cutover 1 Juni 2026**. Owner input "Jurnal Pembukaan" entry per 31 Mei 2026 = saldo kas/bank/persediaan/piutang/hutang/modal. Dari 1 Juni full auto-journal. Transaksi pre-cutover tetap akses via Finance views existing (tidak di-journal) | Clean break, fast deploy, low migration risk. Backfill semua = high effort + risk error untuk gain history yang Owner jarang lookup back |
| **D59** | Period close cadence = **monthly**, calendar Asia/Jakarta (1-akhir bulan WIB). Period state machine: open → closed → locked. Reopen closed → open Owner-only dengan audit | Selaras siklus payroll bulanan (sudah ada), siklus settlement aggregator, dan praktek umum pembukuan UMKM Indonesia |
| **D60** | Manual journal entry = **Owner-only dengan PIN gate**. Manager bisa view + draft (saved as draft) tapi posting (status='posted') wajib Owner re-PIN. Reverse entry juga Owner-only | Selaras pola void/refund/compliment yang udah ada (D46 PIN required all roles). Ledger integrity = high-stakes, deserves friction |

---

## 2. Chart of Accounts (52 Akun)

4-digit code. Indonesian labels (UI bahasa Indonesia, kode fungsi internal). Normal balance: Debit untuk asset/expense/COGS, Credit untuk liability/equity/revenue. Kontra accounts (`is_contra=true`) flip rule (mis. Akumulasi Penyusutan = kontra-asset, normal balance Credit).

### 1xxx — ASET (Assets)

#### 11xx Aset Lancar
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `1101` | Kas Tunai (Drawer POS) | asset | debit | ✅ | Saldo cash drawer aktif (open shift + verified deposit reconcile) |
| `1102` | Kas Tunai (Brankas) | asset | debit | ✅ | Cash on hand di luar drawer (idle) |
| `1110` | Bank BCA | asset | debit | ✅ | Rekening operasional utama |
| `1111` | Bank BRI | asset | debit | ✅ | Rekening cadangan |
| `1112` | Bank Lain-lain | asset | debit | | Owner bisa tambah lewat COA UI |
| `1120` | Piutang QRIS | asset | debit | ✅ | POS QRIS sale → settle T+1 ke bank |
| `1121` | Piutang EDC BCA | asset | debit | ✅ | POS card_bca sale → settle T+1 ke bank |
| `1122` | Piutang GoFood | asset | debit | ✅ | Sale via gofood channel → settle weekly |
| `1123` | Piutang GrabFood | asset | debit | ✅ | Sale via grabfood channel |
| `1124` | Piutang ShopeeFood | asset | debit | ✅ | Sale via shopeefood channel |
| `1130` | Piutang Karyawan (Kasbon) | asset | debit | | Manual entry untuk advance gaji |
| `1140` | Persediaan Bahan Baku — Kitchen | asset | debit | ✅ | Mirror `ingredients.section='kitchen'` value (sum `current_stock × cost_per_unit`) |
| `1141` | Persediaan Bahan Baku — Bar | asset | debit | ✅ | Mirror `section='bar'` |
| `1142` | Persediaan Bahan Pendukung | asset | debit | ✅ | Mirror `section IN ('supporting','cleaning')` |
| `1150` | Biaya Dibayar Dimuka | asset | debit | | Manual entry (sewa prepaid, asuransi) |

#### 12xx Aset Tetap (placeholder, sesi W kalau diaktifkan)
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `1201` | Furniture & Peralatan Cafe | asset | debit | | Sesi W: capitalized purchase ≥ Rp 500k threshold |
| `1202` | Mesin & Peralatan Dapur | asset | debit | | Sesi W |
| `1203` | Peralatan Bar | asset | debit | | Sesi W |
| `1204` | Peralatan IT (POS, printer, tablet) | asset | debit | | Sesi W |
| `1290` | Akumulasi Penyusutan | asset | credit | | Kontra-asset, sesi W (depresiasi otomatis bulanan) |

### 2xxx — KEWAJIBAN (Liabilities)

| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `2101` | Hutang Dagang (TOP Supplier) | liability | credit | ✅ | Auto-credit saat purchase TOP confirm; auto-debit saat mark-paid |
| `2102` | Hutang Gaji | liability | credit | | Phase 3 accrual (kalau payroll period close > tanggal bayar). Sesi R: skip — mark-paid langsung Dr Gaji Cr Bank |
| `2110` | Hutang Pajak | liability | credit | | Placeholder Phase 3 |
| `2120` | Pendapatan Diterima Dimuka | liability | credit | | Manual entry (event booking deposit) |

### 3xxx — EKUITAS (Equity)

| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `3101` | Modal Owner | equity | credit | ✅ | Setoran modal awal + tambahan setoran |
| `3201` | Prive Owner | equity | debit | ✅ | Penarikan Owner (kontra-equity, normal balance debit) |
| `3301` | Saldo Laba Ditahan | equity | credit | ✅ | Akumulasi laba rugi closed periods |
| `3302` | Laba Rugi Berjalan | equity | credit | ✅ | Net income period berjalan, auto-transfer ke 3301 saat period close |

### 4xxx — PENDAPATAN (Revenue)

| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `4101` | Penjualan Makanan | revenue | credit | ✅ | Sum subtotal items dengan category mapped 'food' (lihat §3.3 mapping rule) |
| `4102` | Penjualan Minuman | revenue | credit | ✅ | Sum subtotal items category mapped 'drink' |
| `4103` | Penjualan Lain | revenue | credit | | Merchandise, kalau ada |
| `4110` | Diskon Penjualan | revenue | debit | ✅ | Kontra-revenue. Dr saat discount applied (manual discount + promo), termasuk redeem loyalty points |
| `4111` | Refund Penjualan | revenue | debit | ✅ | Kontra-revenue. Dr saat transaction refunded |
| `4201` | Pendapatan Lain-lain | revenue | credit | ✅ | Sumber dari `incomes` table (event rental, titip jual, dll) |
| `4301` | Pendapatan Bunga Bank | revenue | credit | | Manual entry akhir bulan |

> **D-Compliment treatment**: compliment (reason prefix `Compliment:` dari D45) **tidak** masuk ke 4101/4102 sebagai sale, dan **tidak** masuk ke 4110 sebagai diskon. Compliment = marketing expense (`6304`) — Dr 6304, Cr Persediaan. Lihat §3.3.6.

### 5xxx — HARGA POKOK PENJUALAN (COGS)

| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `5101` | HPP — Makanan | cogs | debit | ✅ | Auto-debit per POS sale paid, sourced dari `transaction_items.cogs` filtered ke food category |
| `5102` | HPP — Minuman | cogs | debit | ✅ | Auto-debit per POS sale paid, drink category |
| `5103` | HPP — Lain | cogs | debit | | Merchandise COGS |

### 6xxx — BEBAN OPERASIONAL (Operating Expenses)

#### 61xx Beban Personalia
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6101` | Gaji Karyawan | expense | debit | ✅ | Auto-debit saat payroll mark-paid (sourced dari `payroll_lines.netPay`). Default mapping untuk `expenses.sourceType='payroll'` |
| `6102` | Tunjangan & Bonus | expense | debit | | Manual entry atau payroll component breakdown (Phase 3) |
| `6103` | Lembur | expense | debit | | Manual atau payroll OT component (Phase 3) |
| `6104` | BPJS / Asuransi Karyawan | expense | debit | | Manual entry bulanan |

#### 62xx Beban Sewa & Utilitas
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6201` | Sewa Tempat | expense | debit | ✅ | Manual expense → mapped ke akun ini lewat selector |
| `6202` | Listrik | expense | debit | ✅ | Manual expense |
| `6203` | Air | expense | debit | ✅ | Manual expense |
| `6204` | Internet & Telepon | expense | debit | ✅ | Manual expense |
| `6205` | Gas (LPG) | expense | debit | ✅ | Manual expense |

#### 63xx Beban Operasional Toko
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6301` | Bahan Pendukung (Cleaning/Packaging) | expense | debit | | Manual or via purchases dengan section='supporting'/'cleaning' (kalau Owner treat as expense langsung — bukan persediaan) |
| `6302` | Pemeliharaan & Perbaikan | expense | debit | | Manual |
| `6303` | Transportasi & Pengiriman | expense | debit | | Manual |
| `6304` | Marketing & Iklan | expense | debit | ✅ | Tujuan default compliment + manual marketing spend |
| `6305` | ATK & Cetak | expense | debit | | Manual |

#### 64xx Beban Channel & Payment
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6401` | Biaya Aggregator | expense | debit | ✅ | Auto-debit saat aggregator settlement masuk (fee component) |
| `6402` | Biaya QRIS / EDC (MDR) | expense | debit | ✅ | Auto-debit saat QRIS/EDC settlement reconcile (kalau ada fee field di `aggregator_settlements`); else manual monthly recap |
| `6403` | Biaya Bank | expense | debit | | Manual (admin fee bank, transfer fee, dll) |

#### 65xx Beban Penyusutan (sesi W)
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6501` | Beban Penyusutan Furniture | expense | debit | | Sesi W |
| `6502` | Beban Penyusutan Peralatan Dapur | expense | debit | | Sesi W |
| `6503` | Beban Penyusutan Peralatan Bar | expense | debit | | Sesi W |
| `6504` | Beban Penyusutan Peralatan IT | expense | debit | | Sesi W |

#### 69xx Beban Lain-lain
| Code | Name | Type | Normal | System | Notes |
|---|---|---|---|---|---|
| `6901` | Lain-lain | expense | debit | ✅ | Default fallback untuk expense tanpa akun explicit |
| `6902` | Selisih Kas (Variance Shift) | expense | debit | ✅ | Auto-debit/credit saat shift close dengan cash variance != 0. Nature kontra-acceptable: kalau surplus, tetap debit dengan negative atau credit ke akun ini (treated as gain) |
| `6903` | Penghapusan Persediaan (Opname Loss) | expense | debit | ✅ | Auto-debit saat opname finalize dengan shortage. Surplus → reversal Cr ke akun ini |

**Total: 52 akun aktif (excluding 5 fixed asset placeholder yang inactive sampai sesi W = 47 akun aktif sesi R-V)**

### 2.1 Mapping Existing Tables → Default Account

Auto-mapping default supaya backend gak butuh selector di setiap action:

| Source | Field | Default Account |
|---|---|---|
| `transactions.paymentMethod='cash'` | trx.total | Dr `1101` |
| `transactions.paymentMethod='qris'` | trx.total | Dr `1120` |
| `transactions.paymentMethod='card_bca'` | trx.total | Dr `1121` |
| `transactions.paymentMethod='split'` | per `splitPayments.method` | each method maps ke akun di atas |
| `transaction_items` (food category) | item.subtotal & item.cogs | Cr `4101` revenue, Dr `5101` COGS |
| `transaction_items` (drink category) | item.subtotal & item.cogs | Cr `4102`, Dr `5102` |
| `transactions.discountAmount` | trx.discountAmount | Dr `4110` |
| `transactions.status='refunded'` | trx.total | Dr `4111`, Cr payment method akun |
| Compliment (reason prefix `Compliment:`) | sum(item.cogs) | Dr `6304`, Cr Persediaan |
| `expenses.sourceType='payroll'` | exp.amount | Dr `6101` (default) |
| `expenses.sourceType='purchase'` | exp.amount | Cr Kas/Bank/Hutang per paymentMethod (purchase flow handles Dr persediaan separately) |
| `expenses.sourceType='refund'` | exp.amount | Already covered by transaction refund flow — skip duplicate |
| `expenses.sourceType='manual'` | exp.amount | **Owner pilih account_id via selector** (default: 6901 lain-lain) |
| `incomes` | income.amount | Cr `4201`, Dr Kas/Bank per paymentMethod |
| `cash_deposits` (verified) | deposit.amount | Dr Bank (per `bank_destination` mapping), Cr `1101` |
| `aggregator_settlements` | gross/fee/net | Dr Bank net + Dr `6401` fee, Cr Piutang Channel gross |
| `purchases` (cash) | total | Dr Persediaan section, Cr Kas/Bank |
| `purchases` (TOP) | total | Dr Persediaan section, Cr `2101` |
| `purchases.markPaid` | total | Dr `2101`, Cr Kas/Bank |
| `shifts.cashVariance` (close) | variance | Dr/Cr `6902` ↔ `1101` |
| `stock_opname_sessions` (finalize) | per-line diff | Dr/Cr `6903` ↔ Persediaan |

Kitchen vs bar split untuk persediaan:
- `ingredients.section='kitchen'` → akun `1140`
- `ingredients.section='bar'` → akun `1141`
- `ingredients.section IN ('supporting','cleaning')` → akun `1142`

Food vs drink split untuk revenue/COGS POS sale (best heuristic, configurable per-category):
- Categories `bakmie` + `ricebowl` + `snack` (slug-based) → food (4101/5101)
- Categories `coffee` + `non-coffee` + `manual-brew` + `tea` → drink (4102/5102)
- Owner bisa override via UI: `categories.accounting_revenue_account` + `categories.accounting_cogs_account` (nullable, fallback ke heuristic)

> Sesi S deliverable: tambah 2 kolom nullable di `categories` + UI selector di Admin Menu → Categories.

---

## 3. Schema Design

### 3.1 `chart_of_accounts`

```typescript
chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  outletId: uuid("outlet_id").notNull().references(() => outlets.id),
  code: text("code").notNull(),                          // "1101"
  name: text("name").notNull(),                          // "Kas Tunai (Drawer POS)"
  type: text("type", {
    enum: ["asset", "liability", "equity", "revenue", "cogs", "expense"],
  }).notNull(),
  normalBalance: text("normal_balance", {
    enum: ["debit", "credit"],
  }).notNull(),
  parentCode: text("parent_code"),                       // "1100" untuk grouping (informational)
  isContra: boolean("is_contra").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),  // system accounts can't be deactivated/deleted
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp(...).defaultNow().notNull(),
  updatedAt: timestamp(...).defaultNow().notNull(),
  deletedAt: timestamp(...),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
}, (t) => [
  uniqueIndex("ux_coa_outlet_code").on(t.outletId, t.code).where(sql`${t.deletedAt} IS NULL`),
  index("idx_coa_lookup").on(t.outletId, t.type, t.isActive, t.displayOrder),
]);
```

### 3.2 `accounting_periods`

```typescript
accountingPeriods = pgTable("accounting_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  outletId: uuid("outlet_id").notNull().references(() => outlets.id),
  periodYear: integer("period_year").notNull(),     // 2026
  periodMonth: integer("period_month").notNull(),   // 6 = Juni
  status: text("status", {
    enum: ["open", "closed", "locked"],
  }).notNull().default("open"),
  openedAt: timestamp(...).defaultNow().notNull(),
  closedAt: timestamp(...),
  closedBy: uuid("closed_by").references(() => users.id),
  lockedAt: timestamp(...),
  lockedBy: uuid("locked_by").references(() => users.id),
  closingEntryId: uuid("closing_entry_id"),          // FK journal_entries (the closing JE)
  notes: text("notes"),
  createdAt: timestamp(...).defaultNow().notNull(),
  updatedAt: timestamp(...).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ux_periods_outlet_year_month").on(t.outletId, t.periodYear, t.periodMonth),
  check("ck_period_month_range", sql`${t.periodMonth} BETWEEN 1 AND 12`),
]);
```

State transitions:
- `open` (default at period creation) → `closed` (Owner clicks "Tutup Periode"): runs closing entry, locks against new posts but allows reverse
- `closed` → `locked` (Owner clicks "Kunci Periode" — irreversible without DB-level intervention): no entries can post or reverse
- `closed` → `open` (Owner reopens, audit logged): allows new entries; closing entry deleted/voided

> Sesi V detail: closing entry = aggregate Cr/Dr revenue & expense → 3302 (Laba Rugi Berjalan), then transfer 3302 → 3301 (Saldo Laba). Two-step or one entry — TBD sesi V implementation.

### 3.3 `journal_entries` (header)

```typescript
journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  outletId: uuid("outlet_id").notNull().references(() => outlets.id),
  periodId: uuid("period_id").notNull().references(() => accountingPeriods.id),
  entryNumber: text("entry_number").notNull(),    // "JE-202606-0001" — unique per outlet+period, atomic
  entryDate: date("entry_date").notNull(),         // tanggal event ekonomi (must fall in period)
  description: text("description").notNull(),
  sourceType: text("source_type", {
    enum: [
      "manual",
      "opening_balance",
      "pos_sale", "pos_refund", "pos_compliment",
      "purchase_create", "purchase_pay", "purchase_cancel",
      "payroll_paid",
      "expense_create", "expense_void",
      "income_create", "income_void",
      "cash_deposit_verified",
      "aggregator_settlement",
      "shift_variance",
      "opname_adjustment",
      "period_close", "period_reopen",
    ],
  }).notNull(),
  sourceId: uuid("source_id"),                     // soft FK to source table; null untuk manual
  status: text("status", {
    enum: ["draft", "posted", "reversed"],
  }).notNull().default("posted"),
  postedAt: timestamp(...),
  postedBy: uuid("posted_by").references(() => users.id),
  reversedByEntryId: uuid("reversed_by_entry_id"),  // self-FK; if set, this entry was reversed by another
  reversesEntryId: uuid("reverses_entry_id"),       // self-FK; if set, this entry IS the reverse of another
  reverseReason: text("reverse_reason"),
  metadata: jsonb("metadata"),                      // additional context: original payload, computed values, etc.
  createdAt: timestamp(...).defaultNow().notNull(),
  updatedAt: timestamp(...).defaultNow().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
}, (t) => [
  uniqueIndex("ux_je_outlet_number").on(t.outletId, t.entryNumber),
  index("idx_je_period").on(t.periodId),
  index("idx_je_source").on(t.sourceType, t.sourceId),  // idempotency lookup
  index("idx_je_date").on(t.outletId, t.entryDate),
]);
```

**Idempotency rule**: per `(outletId, sourceType, sourceId)`, **at most 1 entry with status IN ('posted','draft')**. On re-trigger (mis. retry), skip if exists. Reversed entries don't block (status='reversed' = inactive).

**Entry number format**: `JE-{YYYYMM}-{NNNN}` per outlet, atomic via Postgres advisory lock per (outlet, period). NNNN reset per period.

### 3.4 `journal_lines`

```typescript
journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),    // 1-indexed
  accountId: uuid("account_id").notNull().references(() => chartOfAccounts.id),
  debit: bigint("debit", { mode: "number" }).notNull().default(0),
  credit: bigint("credit", { mode: "number" }).notNull().default(0),
  description: text("description"),                 // line-level (e.g., "GoFood pesanan #12345")
  metadata: jsonb("metadata"),
  createdAt: timestamp(...).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ux_jl_entry_line").on(t.entryId, t.lineNumber),
  index("idx_jl_account").on(t.accountId),
  check("ck_jl_amount_nonneg", sql`${t.debit} >= 0 AND ${t.credit} >= 0`),
  check("ck_jl_xor", sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.debit} = 0 AND ${t.credit} > 0)`),
]);
```

**App-level invariant** (enforced di service layer, double-checked di test):
```
SUM(journal_lines.debit) WHERE entry_id = X
  ===
SUM(journal_lines.credit) WHERE entry_id = X
```

Helper `recordJournal(tx, payload)` validates this dalam DB transaction; throw kalau imbalanced → tx rollback.

### 3.5 Migration 0021 (sesi S deliverable)

Single migration:
1. CREATE TABLE `chart_of_accounts`
2. CREATE TABLE `accounting_periods`
3. CREATE TABLE `journal_entries`
4. CREATE TABLE `journal_lines`
5. ADD COLUMN `categories.accounting_revenue_account_id` (uuid, nullable, FK)
6. ADD COLUMN `categories.accounting_cogs_account_id` (uuid, nullable, FK)
7. Seed 52 default accounts dengan `is_system=true` untuk system accounts
8. Seed default mapping untuk existing categories (food vs drink heuristic)

Order: migrate first, deploy second (sesi S — schema additive only, no breaking change to existing code).

---

## 4. Auto-Journal Mapping (Detail)

Notation: `Dr 1101 = X` artinya debit akun 1101 sebesar X. Lines harus balanced (sum debit = sum credit).

### 4.1 POS Sale — Cash Payment

**Trigger**: `createTransaction` success dengan `paymentMethod='cash'` AND `status='paid'`

**Compute**:
- `food_subtotal` = sum of transaction_items.subtotal where category mapped → food
- `drink_subtotal` = sum where category mapped → drink
- `discountAmount` = trx.discountAmount
- `food_cogs` = sum of transaction_items.cogs where category mapped → food
- `drink_cogs` = sum where category mapped → drink
- `kitchen_cogs_breakdown` + `bar_cogs_breakdown` = sum cogs per ingredient.section (untuk credit ke 1140 vs 1141)

**Journal**:
```
Dr 1101 Kas Tunai                       trx.total
Dr 4110 Diskon Penjualan                discountAmount   (kalau > 0)
   Cr 4101 Penjualan Makanan              food_subtotal
   Cr 4102 Penjualan Minuman              drink_subtotal

Dr 5101 HPP Makanan                     food_cogs        (kalau > 0)
Dr 5102 HPP Minuman                     drink_cogs       (kalau > 0)
   Cr 1140 Persediaan Kitchen             kitchen_cogs_amount
   Cr 1141 Persediaan Bar                 bar_cogs_amount
```

(2 separate journal entries — atau 1 with all 8 lines? Keep as 1 entry per transaction untuk reconciliation simplicity. sourceType='pos_sale', sourceId=trx.id.)

Edge case: `food_cogs=0` (semua items belum punya recipe/cogs filled) → skip COGS lines, log warning (Owner harus review).

### 4.2 POS Sale — QRIS / EDC

Same as cash, swap akun kas:
- `paymentMethod='qris'` → `Dr 1120 Piutang QRIS`
- `paymentMethod='card_bca'` → `Dr 1121 Piutang EDC BCA`

### 4.3 POS Sale — Split Payment

Iterate `splitPayments` array. Per method, debit akun yang sesuai. Sum equals trx.total.

```
Dr 1101 Kas Tunai                       split.cash_amount
Dr 1120 Piutang QRIS                    split.qris_amount
Dr 1121 Piutang EDC BCA                 split.card_bca_amount
   Cr 4101/4102/4110 (same as 4.1)
+ COGS lines (same as 4.1)
```

### 4.4 POS Sale — Aggregator Channel

Untuk transaksi yang flag-nya channel = gofood/grabfood/shopeefood (via field di transaction atau split). Setelah confirm dengan Owner mekanisme transaksi aggregator:

**Asumsi sementara** (CONFIRM SESI S sebelum implement): aggregator orders di-record sebagai transaksi terpisah di POS dengan `paymentMethod='aggregator'` (perlu tambah enum) atau via field `channel` baru. Sesi S: clarify dengan Owner mekanisme aktual, lalu mapping:

```
Dr 1122 Piutang GoFood                  trx.total (gross)
   Cr 4101/4102 Penjualan
+ COGS
```

Settlement aggregator (lihat §4.10) yang clear piutang ini.

### 4.5 POS Refund

**Trigger**: `refundTransaction` action

**Journal** (reverse of original sale):
```
Dr 4111 Refund Penjualan               trx.total
   Cr 1101 / 1120 / 1121 / etc          per original paymentMethod
```

**COGS reversal**: by default **tidak** reverse (barang sudah dikonsumsi/diberikan). Owner bisa pilih per refund flag `reverseCogs` (UI checkbox, default off):
```
Dr 1140/1141 Persediaan                cogs_amount
   Cr 5101/5102 HPP
```

### 4.6 POS Compliment

**Trigger**: `createTransaction` dengan reason prefix `Compliment:` (D45) — total = 0, discount = 100%

**Journal** (no revenue, no kas — pure marketing expense):
```
Dr 6304 Marketing & Iklan              sum(item.cogs)
   Cr 1140/1141 Persediaan              per ingredient section
```

`sourceType='pos_compliment'`, `sourceId=trx.id`.

### 4.7 Purchase — Cash Payment

**Trigger**: `purchase.confirm` dengan `paymentMethod='cash'` (atau transfer_bca/transfer_bri/transfer_other)

**Compute**:
- Persediaan breakdown per `ingredient.section`:
  - kitchen → 1140
  - bar → 1141
  - supporting/cleaning → 1142

**Journal**:
```
Dr 1140 Persediaan Kitchen             sum_kitchen_total
Dr 1141 Persediaan Bar                 sum_bar_total
Dr 1142 Persediaan Pendukung           sum_supporting_total
   Cr 1101 Kas / 1110 Bank BCA / 1111 Bank BRI / 1112 Bank Lain   total
```

`sourceType='purchase_create'`, `sourceId=purchase.id`.

> Existing Q1 flow already creates kas expense. Setelah accounting hadir, expense auto-create di-skip (atau di-keep tapi journal tidak counted via expense — sourceType='purchase' di expenses table di-flag `skip_journal=true`). Detail final di sesi U.

### 4.8 Purchase — TOP

**Trigger**: `purchase.confirm` dengan `paymentMethod='top'`

**Journal**:
```
Dr 1140/1141/1142 Persediaan           per section breakdown
   Cr 2101 Hutang Dagang                 total
```

**Mark-paid trigger**: `purchase.markPaid`
```
Dr 2101 Hutang Dagang                  total
   Cr 1101 Kas / 1110 Bank / 1111 Bank   per paymentMethod
```

`sourceType='purchase_pay'`, `sourceId=purchase.id`.

### 4.9 Cash Deposit (Setoran Tunai) Verified

**Trigger**: `cashDeposit.verify` action (Owner approve)

**Journal**:
```
Dr 1110 Bank BCA / 1111 Bank BRI       deposit.amount
   Cr 1101 Kas Tunai (Drawer POS)        deposit.amount
```

Bank destination dari `cash_deposits.bank_destination` field (free text). Mapping rule: contains "BCA" → 1110, "BRI" → 1111, else → 1112 (configurable di Admin → COA).

`sourceType='cash_deposit_verified'`, `sourceId=cashDeposit.id`.

### 4.10 Aggregator Settlement

**Trigger**: `aggregatorSettlement.create` (manual entry oleh Owner/Manager saat dana masuk bank)

**Journal**:
```
Dr 1110 Bank (per bank_credited_to)    settlement.net
Dr 6401 Biaya Aggregator               settlement.fee
   Cr 1122 / 1123 / 1124 Piutang Channel  settlement.gross
```

Channel mapping:
- `channel='gofood'` → Cr 1122
- `channel='grabfood'` → Cr 1123
- `channel='shopeefood'` → Cr 1124
- `channel='qris'` → Cr 1120
- `channel='edc_bca'` → Cr 1121

`sourceType='aggregator_settlement'`, `sourceId=settlement.id`.

### 4.11 Payroll Mark-Paid

**Trigger**: `markPayrollPaid` action (existing Q1 flow)

**Compute**: `total_net_pay = sum(payroll_lines.netPay)` for the period

**Journal**:
```
Dr 6101 Gaji Karyawan                  total_net_pay
   Cr 1101 Kas / 1110 Bank                per paymentMethod (default 'transfer' = Bank BCA)
```

`sourceType='payroll_paid'`, `sourceId=payrollPeriod.id`.

> Q1 flow already auto-creates expense entry. Untuk avoid double-counting di reports: existing expense entry tetap di-keep (Finance views pakai), tapi accounting layer skip auto-journal dari expense (sourceType='payroll' tidak trigger auto-journal di expense.create flow — sudah di-cover oleh payroll_paid hook).

### 4.12 Manual Expense Create

**Trigger**: `expense.create` dengan `sourceType='manual'`

**Required input**: `accountId` (selector, default `6901 Lain-lain`)

**Journal**:
```
Dr {selected expense account}          expense.amount
   Cr 1101 Kas / 1110 Bank / 1111 Bank   per paymentMethod
```

`sourceType='expense_create'`, `sourceId=expense.id`.

> Sesi U: tambah `account_id` field nullable di `expenses` table (FK chart_of_accounts), exposed di admin form. Default mapping per `expense_categories.default_account_id` (kolom baru di expense_categories).

### 4.13 Income Create

**Trigger**: `income.create`

**Journal**:
```
Dr 1101 Kas / 1110 Bank / 1111 Bank    income.amount
   Cr 4201 Pendapatan Lain-lain          income.amount
```

`sourceType='income_create'`, `sourceId=income.id`.

### 4.14 Shift Cash Variance (Selisih Kas)

**Trigger**: `closeShift` dengan `variance != 0`

**Journal** (kalau variance < 0, kas kurang):
```
Dr 6902 Selisih Kas                    |variance|
   Cr 1101 Kas Tunai
```

(kalau variance > 0, kas extra):
```
Dr 1101 Kas Tunai                      variance
   Cr 6902 Selisih Kas (treated as gain)
```

`sourceType='shift_variance'`, `sourceId=shift.id`.

### 4.15 Stock Opname Finalize (Penyesuaian Persediaan)

**Trigger**: `stockOpname.finalize` action

**Compute** per line: `diff_value = (counted - expected) × unit_cost_at_snapshot`

**Journal** — aggregate per ingredient.section:

Shortage (negative diff sum):
```
Dr 6903 Penghapusan Persediaan         |total_shortage_kitchen|
   Cr 1140 Persediaan Kitchen
```

Surplus (positive diff sum):
```
Dr 1140 Persediaan Kitchen             total_surplus_kitchen
   Cr 6903 Penghapusan Persediaan (gain)
```

Kombinasi keduanya = 1 journal entry dengan multi-line. `sourceType='opname_adjustment'`, `sourceId=opnameSession.id`.

### 4.16 Manual Journal Entry (Owner)

**Trigger**: Owner di Admin → Akuntansi → Jurnal Manual → Buat Entry

**Required**:
- Date (must fall in open period)
- Description
- Lines (≥ 2, balanced)
- PIN re-confirm before status='posted'

Manager bisa save sebagai `status='draft'` tanpa PIN. Owner approve + post draft (atau langsung create sebagai posted dengan PIN).

`sourceType='manual'`, `sourceId=null`.

### 4.17 Opening Balance (Cutover 1 Juni 2026)

**Trigger**: One-time, Owner input lewat wizard di Admin → Akuntansi → Cutover

**Required input** per akun aset/kewajiban/ekuitas non-zero:
- Kas tunai actual (drawer + brankas)
- Saldo bank BCA, BRI per 31 Mei 2026
- Persediaan value (sum dari ingredients × cost — auto-computed)
- Piutang QRIS/EDC pending settle
- Hutang dagang pending pay (auto-computed dari purchases.status='pending_payment')
- Modal Owner (input)
- Saldo Laba (input — dari pembukuan manual sebelumnya, atau 0 kalau fresh start)

**Journal** (single entry, dated 31 Mei 2026 di period special "opening"):
```
Dr 1101 Kas Tunai                      input
Dr 1110 Bank BCA                       input
Dr 1111 Bank BRI                       input
Dr 1140/1141/1142 Persediaan           auto-computed per section
Dr 1120/1121/1122/1123/1124 Piutang    input per channel
   Cr 2101 Hutang Dagang                  auto-computed
   Cr 3101 Modal Owner                    input
   Cr 3301 Saldo Laba                     input (atau 0)
```

Must balance. Owner adjust nilai sampai balance, then PIN confirm posting.

`sourceType='opening_balance'`, `sourceId=null`. Special period: 2026-05 created as `status='locked'` (read-only), 2026-06 created as `status='open'`.

### 4.18 Period Close & Reopen

**Trigger**: Owner clicks "Tutup Periode {YYYY-MM}"

**Validation**:
- Period harus `status='open'`
- Semua draft entries di period harus di-post atau di-discard
- Optional: warning kalau ada akun piutang/hutang dengan saldo lama (mis. Piutang GoFood Rp 5jt > 30 hari) — Owner acknowledge

**Closing entry** (auto-generated, sourceType='period_close'):
```
For each revenue account (4xxx) with credit balance B:
  Dr {revenue account}                  B
     Cr 3302 Laba Rugi Berjalan          B

For each contra-revenue + expense + cogs account (4110/4111/5xxx/6xxx) with debit balance B:
  Dr 3302 Laba Rugi Berjalan            B
     Cr {account}                        B

Then transfer 3302 to 3301:
  If 3302 has credit balance (profit):
    Dr 3302 Laba Rugi Berjalan          balance
       Cr 3301 Saldo Laba Ditahan        balance
  If 3302 has debit balance (loss):
    Dr 3301 Saldo Laba Ditahan          balance
       Cr 3302 Laba Rugi Berjalan        balance
```

After post: `period.status = 'closed'`, `period.closingEntryId = entry.id`.

**Lock**: Owner clicks "Kunci" — `period.status = 'locked'`. No new posts/reverses possible. Audit logged.

**Reopen**: Owner clicks "Buka Kembali" pada period closed (NOT locked). Closing entry status flip ke 'reversed' (counter-entry created), period.status flip ke 'open'. Audit logged with reason.

---

## 5. Reports

### 5.1 Trial Balance

Per period (or as-of date):

```
Akun                           Debit          Credit
1101 Kas Tunai                  X
1110 Bank BCA                   X
...
2101 Hutang Dagang                              X
3101 Modal Owner                                X
4101 Penjualan Makanan                          X
5101 HPP Makanan                X
6101 Gaji Karyawan              X
...
TOTAL                          ΣD            ΣC
                              (must equal)
```

Query: aggregate `journal_lines` joined `chart_of_accounts`, filter `entry.periodId IN range AND entry.status='posted'`, sum debit/credit per account, compute `closing balance = opening + period_dr - period_cr` (for debit-normal) or `opening + period_cr - period_dr` (credit-normal).

### 5.2 General Ledger per Akun

Detail transaksi per akun, per range:

```
Akun: 1101 Kas Tunai (Drawer POS)
Periode: Juni 2026

Tanggal       Entry      Description                    Debit       Credit       Balance
2026-06-01    JE-202606-0001  Saldo Awal 1 Juni             5,000,000              5,000,000
2026-06-01    JE-202606-0002  POS Sale TRX-...              45,000                 5,045,000
2026-06-01    JE-202606-0003  POS Sale TRX-...              35,000                 5,080,000
2026-06-01    JE-202606-0010  Setoran Bank BCA                          1,000,000  4,080,000
...
TOTAL                                                       X            Y         (closing)
```

### 5.3 Income Statement (Laporan Laba Rugi)

Per period or range:

```
PENDAPATAN
  Penjualan Makanan                    X
  Penjualan Minuman                    X
  Penjualan Lain                       X
  Pendapatan Lain-lain                 X
  (-) Diskon Penjualan                 (X)
  (-) Refund Penjualan                 (X)
TOTAL PENDAPATAN BERSIH                ────  X

HARGA POKOK PENJUALAN
  HPP Makanan                          X
  HPP Minuman                          X
TOTAL HPP                              ────  (X)

LABA KOTOR                             ════  X

BEBAN OPERASIONAL
  Gaji Karyawan                        X
  Sewa Tempat                          X
  Listrik                              X
  ...
  Marketing & Iklan                    X
  Biaya Aggregator                     X
  Selisih Kas                          X
  Lain-lain                            X
TOTAL BEBAN                            ────  (X)

LABA / RUGI BERSIH                     ════  X
```

PDF export available (Owner only).

### 5.4 Balance Sheet (Neraca)

As-of date (default akhir period terakhir closed):

```
ASET
  Aset Lancar
    Kas Tunai (Drawer + Brankas)       X
    Bank BCA                           X
    Bank BRI                           X
    Piutang QRIS/EDC/Aggregator        X
    Persediaan Bahan Baku              X
    Biaya Dibayar Dimuka               X
  Aset Tetap (kalau sesi W aktif)
    Furniture & Peralatan              X
    (-) Akumulasi Penyusutan           (X)
TOTAL ASET                             ════  X

KEWAJIBAN
  Hutang Dagang                        X
  Hutang Pajak                         X
TOTAL KEWAJIBAN                        ────  X

EKUITAS
  Modal Owner                          X
  (-) Prive Owner                      (X)
  Saldo Laba Ditahan                   X
  Laba Rugi Berjalan                   X
TOTAL EKUITAS                          ────  X

TOTAL KEWAJIBAN + EKUITAS              ════  X
                                       (must equal TOTAL ASET)
```

### 5.5 Integration dengan Finance Module Sesi Q

**Selama validation period (sesi V close + 2 minggu)**: dual-source.

| Report (existing) | Source | Plan |
|---|---|---|
| Settlement Harian | shifts + transactions + splitPayments | TIDAK migrate — tetap operational view per-shift |
| Setoran Tunai | cash_deposits | TIDAK migrate — operational lifecycle view |
| Arus Kas (Cash Flow Ledger) | merge expenses + incomes + cash_deposits | Migrate ke GL: filter journal_lines untuk akun kas+bank, group by date |
| Rekonsiliasi Aggregator | aggregator_settlements vs shifts.{channel}Settlement vs transactions | TIDAK migrate — comparison view |
| Hutang Dagang | purchases.status='pending_payment' | Migrate option: derive dari saldo akun 2101. Kalau match, deprecate query lama |
| Daily Cash Summary | transactions + expenses by date | Migrate ke GL filter |

Setelah 2 minggu live + match: existing Cash UI + Arus Kas view di-rewire ke pakai journal_lines, dual-source dimatikan.

---

## 6. RBAC

New permissions (~10):

| Permission | Owner | Manager | Staff | Notes |
|---|---|---|---|---|
| `accounting.coa.view` | ✅ | ✅ | ❌ | Read COA |
| `accounting.coa.manage` | ✅ | ❌ | ❌ | Create/edit/deactivate akun (system accounts protected) |
| `accounting.journal.view` | ✅ | ✅ | ❌ | Read journal entries |
| `accounting.journal.draft` | ✅ | ✅ | ❌ | Save manual entry as draft |
| `accounting.journal.post` | ✅ | ❌ | ❌ | Post (PIN required even for Owner per D60) |
| `accounting.journal.reverse` | ✅ | ❌ | ❌ | Reverse posted entry (PIN required) |
| `accounting.period.view` | ✅ | ✅ | ❌ | List periods |
| `accounting.period.close` | ✅ | ❌ | ❌ | Tutup periode (PIN) |
| `accounting.period.reopen` | ✅ | ❌ | ❌ | Buka kembali period closed (PIN, audit) |
| `accounting.period.lock` | ✅ | ❌ | ❌ | Kunci permanent (PIN, audit) |
| `accounting.report.view` | ✅ | ✅ | ❌ | TB, GL, IS, Neraca |
| `accounting.report.export` | ✅ | ❌ | ❌ | PDF export (mirror P&L existing pattern) |
| `accounting.opening_balance.input` | ✅ | ❌ | ❌ | One-time wizard cutover |

---

## 7. Audit Events

New event types (~14):

```
chart_of_accounts.create
chart_of_accounts.update
chart_of_accounts.deactivate
journal_entry.draft
journal_entry.post
journal_entry.reverse
journal_entry.update_draft
accounting_period.open
accounting_period.close
accounting_period.lock
accounting_period.reopen
opening_balance.posted
report.income_statement.export
report.balance_sheet.export
```

Plus existing events ditambahkan ke filter group "Akuntansi" di AuditLogSection (auto-derivation via `startsWith("accounting.")` + `startsWith("journal_entry.")` + `startsWith("chart_of_accounts.")`).

Entity types tambahan: `chart_of_accounts`, `journal_entry`, `accounting_period`.

---

## 8. Implementation Phasing (Sesi S–V Detail)

### Sesi S — Schema + COA + Read-Only Admin UI (~3-4 hari)

**Scope:**
1. Migration 0021: 4 new tables + 2 nullable columns di `categories` + seed 52 default accounts
2. Feature module `src/features/accounting/`:
   - `types.ts` — Account, JournalEntry, JournalLine, AccountingPeriod
   - `schemas.ts` — Zod
   - `queries.ts` — fetchAccounts, fetchJournalEntries, fetchPeriod
   - `actions.ts` — createAccount, updateAccount (manage saja, no journal posting yet)
3. Admin UI:
   - New "Akuntansi" sidebar section (icon: BookOpen) di antara Keuangan & Promo
   - Tab 1: Bagan Akun (CRUD COA, system accounts read-only)
   - Tab 2: Jurnal (list entries — empty awal sesi S, populated saat sesi T+)
   - Tab 3: Periode (list periods — auto-create current month on first load)
4. RBAC perms registered (no enforcement on write actions yet — sesi T+)
5. Tests: schemas, queries pure helpers
6. **NO auto-journal posting yet.**

**Field validate:** Owner buka Akuntansi → lihat 52 akun seed → bisa create custom akun (mis. tambah akun Bank Lain), bisa edit display order, system akun tidak bisa di-delete.

### Sesi T — Auto-Journal POS + Payroll + Cash Deposit + Aggregator (~4-5 hari)

**Scope:**
1. Helper `recordJournal(tx, payload)` — TX-atomic insert entry + lines, validate balanced
2. Hook ke `createTransaction` (pos_sale, all paymentMethods)
3. Hook ke `refundTransaction` (pos_refund)
4. Hook ke `createTransaction` Compliment branch (pos_compliment)
5. Hook ke `markPayrollPaid` (payroll_paid)
6. Hook ke `cashDeposit.verify` (cash_deposit_verified)
7. Hook ke `aggregatorSettlement.create` (aggregator_settlement)
8. Hook ke `closeShift` saat variance != 0 (shift_variance)
9. **Cutover wizard**: one-time UI di Admin → Akuntansi → Cutover (input opening balance, validate sum, post via PIN)
10. Idempotency: per `(sourceType, sourceId)` skip kalau sudah ada
11. Tests: per-event journal shape (compute layer pure function), idempotency
12. **No backfill — auto-journal hanya untuk events post-deploy + post-cutover (dated >= 2026-06-01).**

**Risk**: HIGH — touches `createTransaction` flow yang udah live + dipakai harian. Mitigation: feature flag `accounting.auto_journal_enabled` di `outlets.settings.features`, default OFF. Owner toggle ON setelah sesi T deploy + Owner test 1 transaksi dummy + verify journal benar.

### Sesi U — Auto-Journal Purchases + Manual Expense + Income + Opname (~3-4 hari)

**Scope:**
1. Hook ke `purchase.confirm` (purchase_create, branches cash/TOP)
2. Hook ke `purchase.markPaid` (purchase_pay)
3. Hook ke `purchase.cancel` (purchase_cancel — counter-entry, idempotent)
4. Add `account_id` nullable column ke `expenses` (migration 0022) + `expense_categories.default_account_id`
5. Hook ke `expense.create` (expense_create) — selector di form
6. Hook ke `income.create` (income_create)
7. Hook ke `stockOpname.finalize` (opname_adjustment)
8. UI: account selector di expense form, default mapping per category
9. Tests
10. **Existing payroll/refund expense entries skip auto-journal (sourceType='payroll'/'refund' bypass — already covered upstream).**

### Sesi V — Manual Journal + Period Close + Reports (~4-5 hari)

**Scope:**
1. Manual journal entry UI — multi-line builder, balance indicator real-time, PIN gate on post
2. Reverse journal entry (counter-entry, PIN, audit)
3. Period close action — closing entry generator + state transition
4. Period reopen action (audit)
5. Period lock action (audit)
6. Reports:
   - Trial Balance (per period or as-of date) + PDF export
   - General Ledger (per akun + range) + CSV export
   - Income Statement (Laba Rugi) + PDF
   - Balance Sheet (Neraca) + PDF
7. Validation period start: 2 minggu dual-source dengan Finance views existing
8. Tests: closing entry computation, balance assertions across reports
9. Memory + handover for sesi W (optional fixed asset) atau Tier 2/3 next focus

### Sesi W (OPSIONAL) — Fixed Asset + Depresiasi (~3 hari)

Trigger: Owner request setelah sesi V live. Skip kalau Owner OK dengan expense-langsung untuk furniture purchase.

**Scope:**
1. `fixed_assets` table (name, category, cost, useful_life_months, salvage_value, acquired_date, account_id, accumulated_depreciation_account_id)
2. Capitalization workflow: purchase ≥ Rp 500k → toggle "Capitalize sebagai Aset Tetap" di Purchase form → instead of expense, Dr 1201/1202/etc Cr Kas/Bank
3. Monthly depreciation cron (atau on-demand button "Hitung Depresiasi Bulan Ini" dijalankan Owner saat period close): straight-line, Dr 6501-6504 Cr 1290 per asset
4. Asset register UI

---

## 9. Open Decisions / Questions for Sesi S

Yang belum di-confirm dari sesi R, akan tanya saat sesi S boot:

1. **Mekanisme transaksi aggregator (gofood/grabfood/shopeefood)**: apakah ada flag channel di transactions table sekarang? Atau Galih input manual sebagai transaksi cash dan settlement-nya separately? Lihat schema `shifts.{channel}Settlement` — apa sumber data-nya? Need clarify before sesi T mapping #4.4.
2. **Kategori Mahakan vs food/drink mapping**: confirm 11 kategori ke 4101 vs 4102:
   - Ricebowl, Bakmie, Snack → makanan (4101)
   - Coffee Based, Non-Coffee, Manual Brew, Tea/Other → minuman (4102)
   - Confirm Owner approve atau ada kategori abu-abu (e.g. Croffle = makanan atau minuman?)
3. **Bank destination mapping rule**: contoh bank_destination user input "BCA" "BRI" "Mandiri" — gimana fuzzy matching? Atau force dropdown dari COA bank accounts? **Rekomendasi**: dropdown selector akun di Admin → Akuntansi (filter type='asset' AND code starts '11' AND is_bank).
4. **MDR (Merchant Discount Rate) untuk QRIS/EDC**: apakah `aggregator_settlements` punya fee field untuk channels qris+edc_bca? Kalau iya, auto-journal include 6402. Kalau tidak, manual monthly recap.
5. **Refund COGS reversal**: default OFF (barang habis dikonsumsi) atau default ON (assume return)? **Rekomendasi default OFF**, Owner toggle per refund.
6. **Compliment cogs computation**: kalau menu_item belum punya recipe (cogs=0), compliment journal jadi Dr 0 Cr 0 → skip entry? Atau Dr 6304 Cr Persediaan amount=0 = invalid. **Rekomendasi**: skip entry kalau cogs=0, log warning "Compliment tanpa cogs — review recipe untuk akurasi marketing expense".
7. **Owner kasbon (1130 Piutang Karyawan)**: apakah ada use case sekarang? Kalau iya, gimana mekanisme record (manual journal? form khusus?). **Rekomendasi sesi V**: tambah "Kasbon Karyawan" form sederhana di Admin → HR → Karyawan detail, generate manual journal Dr 1130 Cr Kas, settle via deduction di payroll bulanan (Dr 1101 Cr 1130 saat gaji potong).

---

## 10. Risks & Mitigations

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| A1 | Auto-journal bug ship → ledger korup | Medium | **Critical** | Feature flag default OFF, Owner toggle ON post-test. Idempotency per (sourceType, sourceId). DB constraint balance_check. Unit test per-event mapping. Reverse-engineer integrity check tool: nightly cron compare sum debit vs sum credit per period, alert kalau drift |
| A2 | Performance — POS sale jadi slow karena tambah journal insert dalam TX | Low | Medium | Insert journal_entries + journal_lines = ~6-8 row insert per sale. Negligible vs existing 10+ inserts (transaction + items + modifiers + audit). Index on source lookup. Profile sesi T |
| A3 | Cutover salah input opening balance → laporan period 1 wrong | Medium | High | Wizard validation (sum debit = sum credit), Owner review preview before post, audit log `opening_balance.posted` includes full payload. Owner bisa reverse + redo selama period 2026-06 belum closed |
| A4 | Period close logic bug → laba rugi salah masuk Saldo Laba | Low | High | Unit test closing entry per scenario (profit, loss, mixed). Manual review first 2 closings (Juni, Juli) sebelum lock |
| A5 | Race condition pada entry_number generation (concurrent sales) | Low | Medium | Postgres advisory lock per (outlet, period) saat generate next NNNN. Same pattern dengan transaction_number existing |
| A6 | Owner edit COA di tengah period (rename/deactivate akun yang udah dipakai) | Medium | Medium | System accounts blocked from edit. Custom accounts: warning kalau ada journal_lines reference. Deactivate (bukan delete) supaya history intact |
| A7 | Finance views existing drift dari ledger setelah validation period | Medium | Medium | Reconciliation tool: query "saldo kas per ledger" vs "saldo kas per Finance view" — kalau drift, surface ke Admin → Akuntansi → Reconciliation tab |
| A8 | Owner skip period close → laba rugi numpuk di 3302 | Low | Low | Banner di Dashboard "Periode {bulan} belum ditutup ({N} hari sejak akhir bulan)" — nag Owner |

---

## 11. Test Strategy

### Unit (per sesi)

- **Sesi S**: COA seed integrity (52 accounts, system flag, normal balance), schemas zod
- **Sesi T**: per-event journal compute (cash sale, qris sale, split, refund, compliment with/without cogs, payroll, cash deposit, aggregator, shift variance) — pure function `computeJournal(payload)` returns expected lines
- **Sesi U**: purchase compute (cash, TOP, mark-paid, cancel reverse), expense compute, opname compute
- **Sesi V**: closing entry compute (profit, loss, zero), trial balance compute (assert balanced), income statement compute, balance sheet compute (assert assets = liab + equity)

Target: 50-80 new unit tests across sesi S-V.

### Integration / Field Validate

- Sesi T deploy + cutover wizard test (Owner + dummy data, then real opening balance)
- Sesi T+1 first real day: monitor 1 hari real transaksi, manual cross-check ledger vs Finance views — should match
- Sesi V first period close: Owner walk through with assistant, verify reports

---

## 12. Memory + Doc Updates Saat Sesi V Close

- Memory: supersede `sesiR-finance-design` dengan `sesiV-accounting-live`
- `docs/00-README.md`: update phase status + add §Accounting reference
- `docs/06-DATABASE-SCHEMA.md`: add §3.14-3.17 untuk 4 new tables
- `docs/99-PHASE-2-ROADMAP.md` §10: append D56-D60 (sesi R) + any sesi S-V additions
- `PROGRESS.md`: 4 entries (sesi S, T, U, V) per close
- This doc (10-ACCOUNTING-DESIGN.md): updated dengan changelog + final actuals

---

## 13. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-02 | Initial design — sesi R close, decisions D56-D60 locked, 5-sesi implementation phasing (S-V + opsional W) |

---

# 🛑 END ACCOUNTING DESIGN v1.0

**Status:** Design approved. Implementation starts sesi S (next sesi).
**Owner action required next sesi:** clarify §9 open questions #1 (aggregator mechanism) before sesi T mapping finalized.
