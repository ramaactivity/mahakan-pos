import {
  pgTable,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Sesi AE-124 — Per-user notification category subscription.
 *
 * Model: opt-in/out per (user, category). Tidak ada row = pakai default
 * berdasarkan email/role (lihat getDefaultCategoriesForUser di helpers).
 * Row ada = ikuti field `enabled`.
 *
 * Snooze: timestamp future. Saat masih aktif (now < snooze_until), notif
 * di-suppress meskipun enabled=true. Auto-expire pas lewat waktu.
 *
 * Categories (enum saat ini, kalau tambah edit di types.ts):
 *   - attendance        — clock-in/out, telat, lupa absen (HR)
 *   - payroll           — slip terkirim, payroll siap kirim
 *   - shift             — belum buka/tutup, balance issue (Finance)
 *   - inventory         — PR, low stock, opname, TOP, perubahan harga
 *   - finance_close     — tutup bulanan, journal error, recon, laporan
 *   - finance_payment   — setoran baru, recurring bill (listrik/sewa)
 *   - marketing         — promo expired, customer milestone
 *   - system            — error aplikasi, aktivitas mencurigakan (dev)
 */
export const userNotificationSubscriptions = pgTable(
  "user_notification_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Category string — TS enum di types.ts. Tidak pakai PG enum supaya
     * tambah category baru cukup TS-level (no migration). */
    category: text("category").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Snooze sampai timestamp future. Null = tidak ada snooze. */
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_user_notif_sub").on(t.userId, t.category),
  ],
);
