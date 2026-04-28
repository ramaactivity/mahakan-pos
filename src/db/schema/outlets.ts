import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export type OperationalHours = {
  [day in "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"]: {
    isOpen: boolean;
    openTime?: string;
    closeTime?: string;
  };
};

export type OutletSettings = {
  features?: {
    loyaltyEnabled?: boolean;
    recipeEnabled?: boolean;
    multiOutletEnabled?: boolean;
    showHppToStaff?: boolean;
  };
  receipt?: {
    /** Existing: short text below "Terima kasih" line. */
    footerText?: string;
    showQrRating?: boolean;
    /** New: 1-3 lines printed above the outlet name (promo banners). */
    headerLines?: string[];
    /** New: WiFi credentials printed in the footer area for customers. */
    wifiSsid?: string;
    wifiPassword?: string;
    /** New: 1-3 free-form lines printed after the footer (notes, IG, etc). */
    extraFooterLines?: string[];
  };
  thresholds?: {
    shiftVarianceAlert?: number;
  };
};

export const outlets = pgTable("outlets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  logoUrl: text("logo_url"),
  operationalHours: jsonb("operational_hours").$type<OperationalHours>(),
  settings: jsonb("settings").$type<OutletSettings>().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
