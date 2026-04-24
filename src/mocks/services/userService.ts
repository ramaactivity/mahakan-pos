import { OUTLET_ID, mockUsers } from "../data";
import type { ApiResult, Paginated, PublicUser, Role, User, UserStatus } from "../types";
import { delay, fail, genId, ok } from "./_helpers";

let users: User[] = mockUsers.map((u) => ({ ...u }));

function toPublicUser(u: User): PublicUser {
  const { passwordHash, pinHash, ...rest } = u;
  return {
    ...rest,
    hasPasswordSet: passwordHash !== null,
    hasPinSet: pinHash !== null,
  };
}

export interface ListUsersOptions {
  role?: Role;
  status?: UserStatus;
  search?: string;
  /** Filter view — matches what a given role is allowed to see. */
  viewerRole?: Role;
}

export async function listUsers(
  options: ListUsersOptions = {},
): Promise<ApiResult<Paginated<PublicUser>>> {
  await delay();
  const { role, status, search, viewerRole } = options;
  const searchLower = search?.toLowerCase().trim();

  const filtered = users.filter((u) => {
    if (u.deletedAt !== null) return false;
    if (role && u.role !== role) return false;
    if (status && u.status !== status) return false;
    if (searchLower && !u.name.toLowerCase().includes(searchLower)) return false;
    // Manager can only see Staff (per docs/05-ROLES-RBAC.md §3)
    if (viewerRole === "manager" && u.role !== "staff") return false;
    if (viewerRole === "staff") return false; // staff can't list users at all
    return true;
  });

  return ok({
    items: filtered.map(toPublicUser),
    total: filtered.length,
  });
}

export async function getUser(id: string): Promise<ApiResult<PublicUser>> {
  await delay();
  const u = users.find((x) => x.id === id && x.deletedAt === null);
  if (!u) return fail("NOT_FOUND", "User tidak ditemukan");
  return ok(toPublicUser(u));
}

// --------------------------------------------------------------------------
// Create
// --------------------------------------------------------------------------

export interface CreateStaffInput {
  name: string;
  pin: string;
  createdBy: string;
}

export interface CreateManagerInput {
  name: string;
  email: string;
  password: string;
  pin?: string;
  createdBy: string;
}

export interface CreateOwnerInput {
  name: string;
  email: string;
  password: string;
  createdBy: string;
}

export async function createStaff(
  input: CreateStaffInput,
): Promise<ApiResult<PublicUser>> {
  await delay();
  if (!/^\d{4,6}$/.test(input.pin)) {
    return fail("VALIDATION_ERROR", "PIN harus 4-6 digit angka", "pin");
  }
  const now = new Date().toISOString();
  const newUser: User = {
    id: genId("user"),
    outletId: OUTLET_ID,
    name: input.name.trim(),
    email: null,
    passwordHash: null,
    pinHash: input.pin, // plaintext in mocks
    role: "staff",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: input.createdBy,
    updatedBy: null,
  };
  users = [...users, newUser];
  return ok(toPublicUser(newUser));
}

export async function createManager(
  input: CreateManagerInput,
): Promise<ApiResult<PublicUser>> {
  await delay();
  const email = input.email.trim().toLowerCase();
  if (users.some((u) => u.email === email && u.deletedAt === null)) {
    return fail("EMAIL_DUPLICATE", "Email sudah terdaftar", "email");
  }
  if (input.password.length < 8) {
    return fail(
      "VALIDATION_ERROR",
      "Password minimal 8 karakter",
      "password",
    );
  }
  const now = new Date().toISOString();
  const newUser: User = {
    id: genId("user"),
    outletId: OUTLET_ID,
    name: input.name.trim(),
    email,
    passwordHash: input.password,
    pinHash: input.pin ?? null,
    role: "manager",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: input.createdBy,
    updatedBy: null,
  };
  users = [...users, newUser];
  return ok(toPublicUser(newUser));
}

// --------------------------------------------------------------------------
// Update
// --------------------------------------------------------------------------

export interface UpdateUserInput {
  id: string;
  name?: string;
  status?: UserStatus;
  updatedBy: string;
}

export async function updateUser(
  input: UpdateUserInput,
): Promise<ApiResult<PublicUser>> {
  await delay();
  const index = users.findIndex(
    (u) => u.id === input.id && u.deletedAt === null,
  );
  if (index === -1) return fail("NOT_FOUND", "User tidak ditemukan");

  const current = users[index];
  // Last Owner protection (per docs/05-ROLES-RBAC.md §8.1)
  if (
    current.role === "owner" &&
    input.status === "inactive"
  ) {
    const activeOwners = users.filter(
      (u) =>
        u.role === "owner" &&
        u.status === "active" &&
        u.deletedAt === null &&
        u.id !== current.id,
    );
    if (activeOwners.length === 0) {
      return fail(
        "LAST_OWNER_PROTECTED",
        "Tidak bisa nonaktifkan Owner terakhir",
      );
    }
  }

  const now = new Date().toISOString();
  users[index] = {
    ...current,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
  return ok(toPublicUser(users[index]));
}

export interface ResetPinInput {
  userId: string;
  newPin: string;
  updatedBy: string;
}

export async function resetPin(
  input: ResetPinInput,
): Promise<ApiResult<PublicUser>> {
  await delay();
  if (!/^\d{4,6}$/.test(input.newPin)) {
    return fail("VALIDATION_ERROR", "PIN harus 4-6 digit angka", "newPin");
  }
  const index = users.findIndex(
    (u) => u.id === input.userId && u.deletedAt === null,
  );
  if (index === -1) return fail("NOT_FOUND", "User tidak ditemukan");
  const now = new Date().toISOString();
  users[index] = {
    ...users[index],
    pinHash: input.newPin,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
  return ok(toPublicUser(users[index]));
}

export async function deactivateUser(
  id: string,
  updatedBy: string,
): Promise<ApiResult<PublicUser>> {
  return updateUser({ id, status: "inactive", updatedBy });
}

export function __resetUserState(): void {
  users = mockUsers.map((u) => ({ ...u }));
}
