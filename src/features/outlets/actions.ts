"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import type { OperationalHours, OutletSettings } from "@/db/schema/outlets";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit";
import type { ApiResult, Outlet } from "./types";

function err(code: string, message: string): ApiResult<never> {
  return { success: false, error: { code, message } };
}

async function requirePerm(perm: Permission) {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  if (!hasPermission(session.user.role, perm)) {
    throw new Error(`FORBIDDEN:${perm}`);
  }
  return session;
}

export async function getOwnOutlet(): Promise<ApiResult<Outlet>> {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", "No session");
  const [row] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!row) return err("NOT_FOUND", "Outlet tidak ditemukan");
  return { success: true, data: row };
}

// ---------- Business Info ----------

const businessInfoSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib").max(100),
  address: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(40).nullable(),
  logoUrl: z.string().trim().max(500).nullable(),
});

export type UpdateBusinessInfoInput = z.infer<typeof businessInfoSchema>;

export async function updateBusinessInfo(
  input: UpdateBusinessInfoInput,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm("settings.business.update");
  } catch (e) {
    const m = e instanceof Error ? e.message : "FORBIDDEN";
    return err(m.startsWith("FORBIDDEN") ? "FORBIDDEN" : "UNAUTHORIZED", m);
  }

  const parsed = businessInfoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const [row] = await db
    .update(outlets)
    .set({
      name: v.name,
      address: v.address?.trim() || null,
      phone: v.phone?.trim() || null,
      logoUrl: v.logoUrl?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  const beforeSnap = {
    name: before.name,
    address: before.address,
    phone: before.phone,
    logoUrl: before.logoUrl,
  };
  const afterSnap = {
    name: row.name,
    address: row.address,
    phone: row.phone,
    logoUrl: row.logoUrl,
  };
  const diff = diffShallow(beforeSnap, afterSnap);
  if (diff) {
    await logAudit({
      eventType: "settings.update",
      userId: session.user.id,
      entityType: "outlet",
      entityId: row.id,
      payload: {
        summary: "Update info bisnis",
        before: beforeSnap,
        after: afterSnap,
        diff,
        context: { section: "business" },
      },
      metadata: { outletId: row.id, actorRole: session.user.role },
    });
  }

  return { success: true, data: row };
}

// ---------- Operational Hours ----------

const dayHoursSchema = z
  .object({
    isOpen: z.boolean(),
    openTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Format jam HH:MM")
      .optional(),
    closeTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Format jam HH:MM")
      .optional(),
  })
  .refine(
    (h) => !h.isOpen || (h.openTime && h.closeTime),
    "Hari buka harus punya jam buka & jam tutup",
  );

const operationalHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

export async function updateOperationalHours(
  input: OperationalHours,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm("settings.hours.update");
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const parsed = operationalHoursSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const [row] = await db
    .update(outlets)
    .set({ operationalHours: parsed.data, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: "Update jam operasional",
      before: { operationalHours: before.operationalHours },
      after: { operationalHours: row.operationalHours },
      context: { section: "operationalHours" },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}

// ---------- Receipt + Thresholds + Features (settings JSONB) ----------

const receiptSchema = z.object({
  footerText: z.string().trim().max(200).optional(),
  showQrRating: z.boolean().optional(),
});

const thresholdsSchema = z.object({
  shiftVarianceAlert: z.number().int().min(0).max(99_999_999),
});

const featuresSchema = z.object({
  showHppToStaff: z.boolean().optional(),
  loyaltyEnabled: z.boolean().optional(),
  recipeEnabled: z.boolean().optional(),
  multiOutletEnabled: z.boolean().optional(),
});

async function updateSettingsSection(
  perm: Permission,
  section: "receipt" | "thresholds" | "features",
  patch: Partial<OutletSettings[keyof OutletSettings]>,
): Promise<ApiResult<Outlet>> {
  let session;
  try {
    session = await requirePerm(perm);
  } catch (e) {
    return err("FORBIDDEN", e instanceof Error ? e.message : "FORBIDDEN");
  }

  const [before] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!before) return err("NOT_FOUND", "Outlet tidak ditemukan");

  const beforeSettings: OutletSettings = before.settings ?? {};
  const merged: OutletSettings = {
    ...beforeSettings,
    [section]: { ...(beforeSettings[section] ?? {}), ...patch },
  };

  const [row] = await db
    .update(outlets)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(outlets.id, session.user.outletId))
    .returning();

  await logAudit({
    eventType: "settings.update",
    userId: session.user.id,
    entityType: "outlet",
    entityId: row.id,
    payload: {
      summary: `Update settings.${section}`,
      before: { [section]: beforeSettings[section] },
      after: { [section]: row.settings?.[section] },
      context: { section },
    },
    metadata: { outletId: row.id, actorRole: session.user.role },
  });

  return { success: true, data: row };
}

export async function updateReceiptSettings(
  input: z.input<typeof receiptSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.receipt.update",
    "receipt",
    parsed.data,
  );
}

export async function updateThresholds(
  input: z.input<typeof thresholdsSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = thresholdsSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.thresholds.update",
    "thresholds",
    parsed.data,
  );
}

export async function updateFeatures(
  input: z.input<typeof featuresSchema>,
): Promise<ApiResult<Outlet>> {
  const parsed = featuresSchema.safeParse(input);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  return updateSettingsSection(
    "settings.features.update",
    "features",
    parsed.data,
  );
}
