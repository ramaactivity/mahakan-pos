"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { employees, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission, type Role } from "@/lib/auth";
import { canActOnRole } from "@/lib/auth/rbac";
import { hashPassword } from "@/lib/auth/password";
import { hashPin, isValidPinFormat } from "@/lib/auth/pin";
import { diffShallow, logAudit } from "@/lib/audit/logger";
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
  type CreateOwnerInput,
  type CreateStaffInput,
  type CreateSupervisorInput,
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

const createSupervisorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pin: pinSchema,
});

const createManagerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  password: z.string().min(8).max(200),
  pin: pinSchema.optional(),
});

const createOwnerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  password: z.string().min(12).max(200),
  pin: pinSchema.optional(),
});

const updateUserSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  // Empty string = clear (only allowed when target role is PIN-only)
  email: z
    .union([z.literal(""), z.email().max(200)])
    .optional()
    .nullable(),
  role: z.enum(["owner", "manager", "supervisor", "staff"]).optional(),
  // Empty string = clear (only allowed when target role is PIN-only).
  // Min length validated separately based on target role below (12 for owner, 8 for manager).
  password: z
    .union([z.literal(""), z.string().max(200)])
    .optional()
    .nullable(),
  pin: pinSchema.optional(),
  clearPin: z.boolean().optional(),
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

/**
 * Phase 8.1 Option B (sesi AC-4) — create Supervisor user. PIN-based seperti
 * Staff (login via /pin di POS). Untuk akses back-office password-based,
 * Owner update email + password-hash via update flow nanti. Manager+Owner
 * bisa create (reuse user.create.staff perm).
 */
export async function createSupervisor(
  input: CreateSupervisorInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requirePerm("user.create.staff");

  const parsed = createSupervisorSchema.safeParse(input);
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
      role: "supervisor",
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
      summary: `Tambah supervisor ${row.name}`,
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

export async function createOwner(
  input: CreateOwnerInput,
): Promise<ApiResult<PublicUser>> {
  const session = await requirePerm("user.create.owner");

  const parsed = createOwnerSchema.safeParse(input);
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
      role: "owner",
      status: "active",
      createdBy: session.user.id,
    })
    .returning();

  // Owner creation is sensitive — surface in summary so it stands out in
  // audit log filter; also include actor email for traceability.
  await logAudit({
    eventType: "user.create",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: `Tambah OWNER ${row.name} (${row.email}) — granted full access`,
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

  // Role-scoped permission on the TARGET (current) role.
  const updatePerm: Permission =
    target.role === "staff" || target.role === "supervisor"
      ? "user.update.staff"
      : target.role === "manager"
        ? "user.update.manager"
        : "user.update.owner";
  if (!hasPermission(session.user.role, updatePerm)) {
    return fail("FORBIDDEN", `Tidak punya hak update ${target.role}`);
  }
  if (!canActOnRole(session.user.role, target.role)) {
    return fail(
      "FORBIDDEN",
      "Tidak bisa update user dengan role yang sama atau lebih tinggi",
    );
  }

  // -------- Role change validations --------
  const newRole: Role = v.role ?? target.role;
  const roleChanged = newRole !== target.role;
  if (roleChanged) {
    // Owner-only privilege to change role (cross-tier reassignment is sensitive).
    if (session.user.role !== "owner") {
      return fail(
        "FORBIDDEN",
        "Hanya Owner yang bisa mengubah role user",
      );
    }
    // Actor must be able to act on BOTH old and new roles.
    if (!canActOnRole(session.user.role, newRole)) {
      return fail("FORBIDDEN", `Tidak bisa promote ke ${newRole}`);
    }
  }

  const newIsPasswordRole = newRole === "manager" || newRole === "owner";
  const newIsPinRole = newRole === "staff" || newRole === "supervisor";

  // -------- Last-Owner protection --------
  // Triggered when target is current owner AND change would drop their owner status:
  // either status→inactive OR role→non-owner.
  const losesOwnership =
    target.role === "owner" &&
    (v.status === "inactive" || (roleChanged && newRole !== "owner"));
  if (
    losesOwnership &&
    (await countActiveOwners(session.user.outletId, target.id)) === 0
  ) {
    return fail(
      "LAST_OWNER_PROTECTED",
      "Tidak bisa demote/nonaktifkan Owner terakhir",
    );
  }

  // -------- Email validation --------
  let emailUpdate: string | null | undefined = undefined; // undefined = no change
  if (v.email !== undefined) {
    if (v.email === "" || v.email === null) {
      if (newIsPasswordRole) {
        return fail(
          "VALIDATION_ERROR",
          `Role ${newRole} wajib punya email`,
          "email",
        );
      }
      emailUpdate = null;
    } else {
      const normalized = v.email.toLowerCase();
      if (normalized !== (target.email ?? "")) {
        if (await emailTaken(session.user.outletId, normalized)) {
          return fail("EMAIL_DUPLICATE", "Email sudah terdaftar", "email");
        }
      }
      emailUpdate = normalized;
    }
  }
  // Enforce email presence when promoting to password role.
  if (roleChanged && newIsPasswordRole) {
    const willHaveEmail =
      emailUpdate !== undefined ? emailUpdate : target.email;
    if (!willHaveEmail) {
      return fail(
        "VALIDATION_ERROR",
        `Promosi ke ${newRole} butuh email login`,
        "email",
      );
    }
  }
  // Clearing email when remaining password role is forbidden.
  if (
    !roleChanged &&
    newIsPasswordRole &&
    (emailUpdate === null || emailUpdate === "")
  ) {
    return fail(
      "VALIDATION_ERROR",
      `Role ${newRole} wajib punya email`,
      "email",
    );
  }

  // -------- Password validation --------
  let passwordHashUpdate: string | null | undefined = undefined;
  if (v.password !== undefined && v.password !== null) {
    if (v.password === "") {
      if (newIsPasswordRole) {
        return fail(
          "VALIDATION_ERROR",
          `Role ${newRole} wajib punya password`,
          "password",
        );
      }
      passwordHashUpdate = null;
    } else {
      const minLen = newRole === "owner" ? 12 : 8;
      if (v.password.length < minLen) {
        return fail(
          "VALIDATION_ERROR",
          `Password ${newRole} minimal ${minLen} karakter`,
          "password",
        );
      }
      passwordHashUpdate = await hashPassword(v.password);
    }
  }
  // If promoting to password role and user has no password yet, require one.
  if (roleChanged && newIsPasswordRole) {
    const willHavePassword =
      passwordHashUpdate !== undefined
        ? passwordHashUpdate !== null
        : target.hasPasswordSet;
    if (!willHavePassword) {
      return fail(
        "VALIDATION_ERROR",
        `Promosi ke ${newRole} butuh password baru`,
        "password",
      );
    }
  }

  // -------- PIN validation --------
  let pinHashUpdate: string | null | undefined = undefined;
  if (v.pin !== undefined && v.pin !== "") {
    pinHashUpdate = await hashPin(v.pin);
  } else if (v.clearPin === true) {
    // Cannot clear PIN if target role would have no other auth.
    const willHavePassword =
      passwordHashUpdate !== undefined
        ? passwordHashUpdate !== null
        : target.hasPasswordSet;
    if (newIsPinRole || !willHavePassword) {
      return fail(
        "VALIDATION_ERROR",
        "Tidak bisa hapus PIN — user akan kehilangan akses login",
        "pin",
      );
    }
    pinHashUpdate = null;
  }
  // Promotion to PIN-only role without existing PIN must set one.
  if (roleChanged && newIsPinRole) {
    const willHavePin =
      pinHashUpdate !== undefined
        ? pinHashUpdate !== null
        : target.hasPinSet;
    if (!willHavePin) {
      return fail(
        "VALIDATION_ERROR",
        `Promosi ke ${newRole} butuh PIN baru`,
        "pin",
      );
    }
  }

  // -------- Apply --------
  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.name !== undefined) updates.name = v.name;
  if (v.status !== undefined) updates.status = v.status;
  if (emailUpdate !== undefined) updates.email = emailUpdate;
  if (roleChanged) updates.role = newRole;
  if (passwordHashUpdate !== undefined) updates.passwordHash = passwordHashUpdate;
  if (pinHashUpdate !== undefined) updates.pinHash = pinHashUpdate;

  const [row] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, v.id))
    .returning();

  /* Sesi AE-152 — sync PIN ke linked employee.attendancePinHash. Sama
   * dengan resetPin path. Hanya kalau pin di-set (non-null). Clear PIN
   * (pin=null) tidak clear attendance — owner harus explicit reset di
   * Karyawan tab supaya tidak nuke attendance accidentally. */
  if (v.pin && v.pin.length > 0) {
    try {
      const bcrypt = (await import("bcryptjs")).default;
      const attendanceHash = await bcrypt.hash(v.pin, 10);
      await db
        .update(employees)
        .set({
          attendancePinHash: attendanceHash,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(
          and(eq(employees.userId, v.id), isNull(employees.deletedAt)),
        );
    } catch (e) {
      console.error("[user.update attendance sync failed]", e);
    }
  }

  const isDeactivation = v.status === "inactive" && target.status !== "inactive";
  const isReactivation = v.status === "active" && target.status !== "active";

  const beforeSnap = {
    name: target.name,
    email: target.email,
    role: target.role,
    status: target.status,
  };
  const afterSnap = {
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
  };

  const eventType = isDeactivation
    ? "user.deactivate"
    : roleChanged
      ? "user.role_change"
      : isReactivation
        ? "user.reactivate"
        : "user.update";
  const summary = isDeactivation
    ? `Nonaktifkan ${target.role} ${target.name}`
    : roleChanged
      ? `Ubah role ${target.name}: ${target.role} → ${newRole}`
      : isReactivation
        ? `Aktifkan kembali ${target.role} ${target.name}`
        : `Update ${target.role} ${target.name}`;

  await logAudit({
    eventType,
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary,
      before: beforeSnap,
      after: afterSnap,
      diff: diffShallow(beforeSnap, afterSnap),
      context: {
        passwordChanged: passwordHashUpdate !== undefined,
        pinChanged: pinHashUpdate !== undefined,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicUser(row));
}

/** Re-enable an inactive user. Honors Last-Owner via updateUser. */
export async function reactivateUser(
  id: string,
): Promise<ApiResult<PublicUser>> {
  return updateUser({ id, status: "active" });
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

  // Hierarchy gate FIRST — actor must be authorized to act on target's role.
  // canActOnRole: owner→all, manager→supervisor+staff, supervisor/staff→none.
  // This blocks the prior bug where both branches mapped ke "user.reset_pin.staff"
  // sehingga manager bisa reset PIN owner.
  if (!canActOnRole(session.user.role, target.role)) {
    return fail(
      "FORBIDDEN",
      "Tidak bisa reset PIN user dengan role yang sama atau lebih tinggi",
    );
  }

  // Permission check per target role tier.
  const perm: Permission =
    target.role === "staff" || target.role === "supervisor"
      ? "user.reset_pin.staff"
      : "user.reset_pin.manager";
  if (!hasPermission(session.user.role, perm)) {
    return fail("FORBIDDEN", "Tidak punya hak reset PIN");
  }

  const pinHash = await hashPin(parsed.data.newPin);
  const [row] = await db
    .update(users)
    .set({ pinHash, updatedAt: new Date(), updatedBy: session.user.id })
    .where(eq(users.id, parsed.data.userId))
    .returning();

  /* Sesi AE-152 — sync ke employees.attendancePinHash kalau user ada
   * linked employee record. Owner expectation: 1 PIN, works everywhere
   * (POS login + Absensi Karyawan). Tanpa sync, owner reset PIN di Staff
   * Management → masih gagal login Absensi (PIN beda). Pakai bcrypt sama
   * dengan attendance flow (bcryptjs hash 10 rounds). */
  let syncedToAttendance = false;
  /* True kalau user role bisa absensi tapi belum ter-link → owner perlu
   * link via tab Karyawan. Warning dilampirkan ke response payload. */
  let needsEmployeeLink = false;
  try {
    const bcrypt = (await import("bcryptjs")).default;
    const attendanceHash = await bcrypt.hash(parsed.data.newPin, 10);
    const linkedEmployees = await db
      .update(employees)
      .set({
        attendancePinHash: attendanceHash,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(
        and(
          eq(employees.userId, parsed.data.userId),
          isNull(employees.deletedAt),
        ),
      )
      .returning({ id: employees.id });
    syncedToAttendance = linkedEmployees.length > 0;
    /* Non-owner roles biasanya juga karyawan absensi. Kalau tidak ada link,
     * flag untuk owner. Owner sendiri biasanya tidak absensi → skip flag. */
    if (
      !syncedToAttendance &&
      target.role !== "owner"
    ) {
      needsEmployeeLink = true;
    }
  } catch (e) {
    /* Don't fail the user PIN reset if attendance sync fails. Log it; owner
     * masih bisa manually reset attendance PIN di Karyawan tab kalau perlu. */
    console.error("[user.reset_pin attendance sync failed]", e);
  }

  if (needsEmployeeLink) {
    console.warn(
      `[user.reset_pin] User ${target.name} (${target.role}) tidak ter-link ke employee — PIN Absensi tidak ter-sync. Link via tab Karyawan dulu kalau perlu.`,
    );
  }

  await logAudit({
    eventType: "user.reset_pin",
    userId: session.user.id,
    entityType: "user",
    entityId: row.id,
    payload: {
      summary: `Reset PIN ${target.role} ${target.name}${syncedToAttendance ? " (+sync Absensi)" : ""}`,
      context: { syncedToAttendance, needsEmployeeLink },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(toPublicUser(row));
}
