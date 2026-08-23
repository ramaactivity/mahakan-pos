import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  integer,
  index,
  check,
  jsonb,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi X — Fixed Asset register.
 *
 * Owner-managed table of capitalized assets (furniture, equipment) yang
 * di-depreciate straight-line per bulan. Each asset linked ke pair of
 * accounts: `assetAccountCode` (1201-1204) untuk debit balance + matching
 * depreciation expense account (6501-6504) untuk monthly debit + accumulated
 * depreciation kontra-asset (1290 Akumulasi Penyusutan) untuk monthly credit.
 *
 * Workflow:
 *   1. Owner add asset (manual entry atau capitalize-from-purchase) →
 *      journal entry sourceType='manual' Dr asset Cr Kas/Bank
 *   2. Monthly depreciation (Owner button click): per asset compute
 *      monthly_dep = (cost - salvage) / useful_life_months → journal entry
 *      sourceType='manual' Dr beban penyusutan Cr akumulasi penyusutan
 *   3. Disposal (Phase later): asset retired, remove from active list
 *
 * Soft FK ke chart_of_accounts (no .references) untuk avoid circular import
 * vs accounting.ts schema.
 */
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Display name (e.g. "Mesin Espresso La Marzocco Linea Mini"). */
    name: text("name").notNull(),
    /** Optional category label (e.g. "Peralatan Bar", "Furniture", "IT"). */
    category: text("category"),

    /** Acquisition cost in IDR (rupiah integer). */
    cost: bigint("cost", { mode: "number" }).notNull(),
    /** Salvage value at end-of-useful-life. Default 0 untuk simple straight-line. */
    salvageValue: bigint("salvage_value", { mode: "number" }).notNull().default(0),
    /** Useful life dalam bulan (e.g. 60 = 5 tahun). */
    usefulLifeMonths: integer("useful_life_months").notNull(),

    /** Date asset acquired (YYYY-MM-DD WIB). */
    acquiredDate: date("acquired_date").notNull(),

    /** Soft FK to chart_of_accounts.code untuk asset account (e.g. "1201"). */
    assetAccountCode: text("asset_account_code").notNull(),
    /** Soft FK untuk depreciation expense account (e.g. "6501"). */
    depreciationAccountCode: text("depreciation_account_code").notNull(),
    /** Soft FK untuk accumulated depreciation kontra-asset (e.g. "1290"). */
    accumulatedDepreciationAccountCode: text(
      "accumulated_depreciation_account_code",
    )
      .notNull()
      .default("1290"),

    /** Last month yang sudah di-depreciate (YYYY-MM-DD = first day of month).
     * Idempotency: kalau lastDepreciatedMonth >= target month, skip. NULL =
     * belum pernah di-depreciate (acquired month belum diaccrue, will start
     * depreciation di first run). */
    lastDepreciatedMonth: date("last_depreciated_month"),

    /* ========== Sesi AE-214 — revaluasi & penurunan nilai ==========
     *
     * `cost` di atas tetap HARGA PEROLEHAN HISTORIS dan tidak pernah berubah —
     * itu jejak berapa yang benar-benar pernah dibayar. Yang berubah saat aset
     * dinilai ulang adalah angka-angka di bawah ini, yang mencerminkan buku
     * besar. Selama aset tidak pernah dinilai ulang, `gross_amount` = `cost`
     * dan kolom basis semuanya kosong → seluruh perhitungan jatuh ke rumus
     * lama, tidak ada satu angka pun yang bergeser. */

    /** Nilai bruto aset di buku besar (akun 1201-1204). Berubah saat revaluasi
     * (metode eliminasi menulis ulang bruto = nilai wajar). */
    grossAmount: bigint("gross_amount", { mode: "number" }).notNull().default(0),

    /** Nilai dasar penyusutan yang berlaku sekarang. NULL = belum pernah
     * dinilai ulang (pakai `cost`). */
    basisAmount: bigint("basis_amount", { mode: "number" }),
    /** YYYY-MM-01, bulan PERTAMA yang disusutkan memakai basis ini. */
    basisMonth: date("basis_month"),
    /** Akumulasi penyusutan yang tetap tercatat di buku dari SEBELUM basis.
     * 0 sesudah revaluasi (dieliminasi), tetap utuh sesudah penurunan nilai. */
    basisAccumulated: bigint("basis_accumulated", { mode: "number" })
      .notNull()
      .default(0),
    /** Sisa umur manfaat (bulan) terhitung sejak `basis_month`. */
    basisRemainingMonths: integer("basis_remaining_months"),

    /** Saldo akumulasi penurunan nilai (akun 1291) milik aset ini. */
    accumulatedImpairment: bigint("accumulated_impairment", { mode: "number" })
      .notNull()
      .default(0),
    /** Saldo surplus revaluasi (akun 3501) milik aset ini. Dipakai menentukan
     * berapa banyak penurunan berikutnya yang boleh menggerus ekuitas dulu
     * sebelum jadi rugi. */
    revaluationSurplus: bigint("revaluation_surplus", { mode: "number" })
      .notNull()
      .default(0),
    /** Rugi revaluasi aset ini yang pernah masuk laba rugi (akun 6506).
     * Kenaikan berikutnya memulihkan ini DULU sebelum menambah surplus —
     * kalau tidak, rugi mendarat di laba rugi sementara pemulihannya mendarat
     * di ekuitas, dan laba rugi jadi bias turun secara permanen. */
    revaluationLossRecognized: bigint("revaluation_loss_recognized", {
      mode: "number",
    })
      .notNull()
      .default(0),

    /** Soft delete (asset disposed atau hapus mistake). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    index("idx_fixed_assets_outlet_active").on(t.outletId, t.deletedAt),
    index("idx_fixed_assets_acquired").on(t.outletId, t.acquiredDate),
    check("ck_fixed_assets_cost_pos", sql`${t.cost} > 0`),
    check(
      "ck_fixed_assets_salvage_lte_cost",
      sql`${t.salvageValue} >= 0 AND ${t.salvageValue} < ${t.cost}`,
    ),
    check(
      "ck_fixed_assets_useful_life_pos",
      sql`${t.usefulLifeMonths} > 0 AND ${t.usefulLifeMonths} <= 600`,
    ),
    /* Sesi AE-214 — basis itu satu paket: nilainya, bulan mulainya, dan sisa
     * umurnya harus ada bertiga atau tidak sama sekali. Basis setengah terisi
     * bikin penyusutan diam-diam jatuh ke rumus lama dengan nilai baru. */
    check(
      "ck_fixed_assets_basis_shape",
      sql`(${t.basisAmount} IS NULL AND ${t.basisMonth} IS NULL AND ${t.basisRemainingMonths} IS NULL)
          OR (${t.basisAmount} IS NOT NULL AND ${t.basisMonth} IS NOT NULL
              AND ${t.basisRemainingMonths} IS NOT NULL AND ${t.basisRemainingMonths} > 0)`,
    ),
    check(
      "ck_fixed_assets_valuation_nonneg",
      sql`${t.accumulatedImpairment} >= 0 AND ${t.revaluationSurplus} >= 0
          AND ${t.revaluationLossRecognized} >= 0 AND ${t.basisAccumulated} >= 0`,
    ),
  ],
);

/**
 * Sesi AE-214 — riwayat penilaian ulang aset tetap.
 *
 * Satu baris per peristiwa (revaluasi / penurunan nilai / pemulihan), dengan
 * rincian alokasinya: berapa yang mendarat di ekuitas, berapa di laba rugi,
 * berapa akumulasi yang dieliminasi. Rinciannya disimpan, bukan dihitung ulang
 * dari jurnal, karena aturan alokasinya bergantung pada SEJARAH aset (surplus
 * yang masih tersisa, rugi yang pernah diakui) — sejarah itu harus terbaca
 * apa adanya, bukan direkonstruksi.
 *
 * `previousState` menyimpan keadaan aset persis sebelum peristiwa supaya
 * pembatalan mengembalikan keadaan yang sama persis, bukan hasil hitungan
 * mundur yang bisa meleset.
 *
 * `journalEntryId` menunjuk jurnal yang terbentuk; `sourceId` jurnal itu =
 * id baris ini (bukan id asetnya) supaya satu aset boleh dinilai ulang
 * berkali-kali — `ux_je_outlet_source_active` hanya mengizinkan satu entry
 * aktif per (sourceType, sourceId).
 */
export const fixedAssetValuations = pgTable(
  "fixed_asset_valuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => fixedAssets.id),

    kind: text("kind", {
      enum: ["revaluation", "impairment", "impairment_reversal"],
    }).notNull(),

    /** Tanggal berlakunya penilaian (YYYY-MM-DD WIB) = entry_date jurnalnya. */
    effectiveDate: date("effective_date").notNull(),
    /** Bulan pertama yang disusutkan dengan basis baru (YYYY-MM-01). */
    basisMonth: date("basis_month").notNull(),

    carryingBefore: bigint("carrying_before", { mode: "number" }).notNull(),
    carryingAfter: bigint("carrying_after", { mode: "number" }).notNull(),

    surplusCredit: bigint("surplus_credit", { mode: "number" })
      .notNull()
      .default(0),
    surplusDebit: bigint("surplus_debit", { mode: "number" })
      .notNull()
      .default(0),
    plGain: bigint("pl_gain", { mode: "number" }).notNull().default(0),
    plLoss: bigint("pl_loss", { mode: "number" }).notNull().default(0),
    accumDepEliminated: bigint("accum_dep_eliminated", { mode: "number" })
      .notNull()
      .default(0),
    accumImpairmentDelta: bigint("accum_impairment_delta", { mode: "number" })
      .notNull()
      .default(0),

    remainingLifeMonths: integer("remaining_life_months").notNull(),

    /** Alasan owner (wajib) + dasar penilaiannya (appraisal / harga pasar / dll). */
    reason: text("reason").notNull(),
    valuationBasis: text("valuation_basis"),

    journalEntryId: uuid("journal_entry_id"),
    /** Keadaan aset sebelum peristiwa — untuk pembatalan yang persis. */
    previousState: jsonb("previous_state").notNull(),

    /** Terisi kalau peristiwanya dibatalkan (jurnalnya di-reverse). */
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_fav_asset").on(t.assetId, t.effectiveDate),
    index("idx_fav_outlet_date").on(t.outletId, t.effectiveDate),
    check(
      "ck_fav_remaining_life_pos",
      sql`${t.remainingLifeMonths} > 0 AND ${t.remainingLifeMonths} <= 600`,
    ),
    check("ck_fav_carrying_nonneg", sql`${t.carryingAfter} >= 0`),
    /* Enum `kind` di atas hanya berlaku di TypeScript — kolomnya text biasa,
     * jadi tanpa check ini database menerima jenis apa pun. Jenis yang ngawur
     * tidak akan bikin error di mana pun: riwayatnya tampil tanpa label dan
     * jalur pembatalannya diam-diam salah cabang. */
    check(
      "ck_fav_kind_valid",
      sql`${t.kind} IN ('revaluation', 'impairment', 'impairment_reversal')`,
    ),
  ],
);
