"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { hashPin, isValidPinFormat } from "@/lib/auth/pin";
import { diffShallow, logAudit } from "@/lib/audit";
import {
  countActiveOwners,
  emailTaken,
  fetchUserById,
  fetchUsers,
  toPublicUser,
} from "./queries";
import {
  fail,
  ok,
  type ApiResult,
  type CreateManagerInput,
  type CreateStaffInput,
  type ListUsersOptions,
  type Paginated,
  type PublicUser,
  type ResetPinInput,
  type UpdateUserInput,
} from "./types";

const pinSchema = z
  .string()
  .refine(isValidPinFormat, "PIN harus 4-6 digit angka");

const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pin: pinSchema,
});

const createManagerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  password: z.string().min(8).max(200),
  pin: pinSchema.optional(),
});

const updateUserSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const resetPinSchema = z.object({
  userId: z.uuid(),
  newPin: pinSchema,
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

async function requirePerm(perm: Permission) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, perm)) {
    throw new Error(`FORBIDDEN:${perm}`);
  }
  return session;
}

// ---------- Reads ----------

export async function listUsers(
  opts: ListUsersOptions = {},
): Promise<ApiResult<Paginated<PublicUser>>> {
  const session = await requireSession();
  const canListAll = hasPermission(session.user.role, "user.list.all");
  const canListStaff = hasPermission(session.user.role, "user.list.staff");
  if (!canListAll && !canListStaff) {
    return fail("FORBIDDEN", "Tidak punya hak lihat user");
  }
  return ok(await fetchUsers(session.user.outletId, session.user.role, opts));
}

export async function getUser(id: string): Promise<ApiResult<PublicUser>> {
  await requireSession();
  const u = await fetchUserById(id);
  if (!u) return fail("NOT_FOUND", "User tidak ditemukan");
  return ok(u);
}

// ---------- Create ----------

export async function createStaff(
  input: CreateStaffInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requirePerm("user.create.staff");

  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const pinHash = await hashPin(v.pin);

  const [row] = await db
    .insert(users)
    .values({
      outletId: session.user.outletId,
      name: v.name,
      email: null,
      passwordHash: null,
      pinHash,
      role: "staff",
      status: "active",
      createdBy: session.user.id,
    })
    .returning();
  await logAudit({
    eventType: "user.create",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: `Tambah staff ${row.name}`,
      after: { name: row.name, role: row.role, status: row.status },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok(toPublicUser(row));
}

export async function createManager(
  input: CreateManagerInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requirePerm("user.create.manager");

  const parsed = createManagerSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const email = v.email.toLowerCase();

  if (await emailTaken(session.user.outletId, email)) {
    return fail("EMAIL_DUPLICATE", "Email sudah terdaftar", "email");
  }

  const passwordHash = await hashPassword(v.password);
  const pinHash = v.pin ? await hashPin(v.pin) : null;

  const [row] = await db
    .insert(users)
    .values({
      outletId: session.user.outletId,
      name: v.name,
      email,
      passwordHash,
      pinHash,
      role: "manager",
      status: "active",
      createdBy: session.user.id,
    })
    .returning();
  await logAudit({
    eventType: "user.create",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: `Tambah manager ${row.name} (${row.email})`,
      after: { name: row.name, email: row.email, role: row.role, status: row.status },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });
  return ok(toPublicUser(row));
}

// ---------- Update ----------

export async function updateUser(
  input: UpdateUserInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requireSession();

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const target = await fetchUserById(v.id);
  if (!target) return fail("NOT_FOUND", "User tidak ditemukan");

  // Role-scoped permission
  const updatePerm: Permission =
    target.role === "staff"
      ? "user.update.staff"
      : target.role === "manager"
        ? "user.update.manager"
        : "user.update.owner";
  if (!hasPermission(session.user.role, updatePerm)) {
    return fail("FORBIDDEN", `Tidak punya hak update ${target.role}`);
  }

  // Last-Owner protection
  if (
    target.role === "owner" &&
    v.status === "inactive" &&
    (await countActiveOwners(session.user.outletId, target.id)) === 0
  ) {
    return fail(
      "LAST_OWNER_PROTECTED",
      "Tidak bisa nonaktifkan Owner terakhir",
    );
  }

  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.name !== undefined) updates.name = v.name;
  if (v.status !== undefined) updates.status = v.status;

  const [row] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, v.id))
    .returning();

  const isDeactivation = v.status === "inactive" && target.status !== "inactive";
  await logAudit({
    eventType: isDeactivation ? "user.deactivate" : "user.update",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: isDeactivation
        ? `Nonaktifkan ${target.role} ${target.name}`
        : `Update ${target.role} ${target.name}`,
      before: { name: target.name, status: target.status },
      after: { name: row.name, status: row.status },
      diff: diffShallow(
        { name: target.name, status: target.status },
        { name: row.name, status: row.status },
      ),
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicUser(row));
}

export async function deactivateUser(
  id: string,
): Promise<ApiResult<PublicUser>> {
  return updateUser({ id, status: "inactive" });
}

export async function resetPin(
  input: ResetPinInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requireSession();

  const parsed = resetPinSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }

  const target = await fetchUserById(parsed.data.userId);
  if (!target) return fail("NOT_FOUND", "User tidak ditemukan");

  const perm: Permission =
    target.role === "staff" ? "user.reset_pin.staff" : "user.reset_pin.staff";
  if (!hasPermission(session.user.role, perm)) {
    return fail("FORBIDDEN", "Tidak punya hak reset PIN");
  }

  const pinHash = await hashPin(parsed.data.newPin);
  const [row] = await db
    .update(users)
    .set({ pinHash, updatedAt: new Date(), updatedBy: session.user.id })
    .where(eq(users.id, parsed.data.userId))
    .returning();

  await logAudit({
    eventType: "user.reset_pin",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: `Reset PIN ${target.role} ${target.name}`,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicUser(row));
}
