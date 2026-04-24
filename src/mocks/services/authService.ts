import {
  mockUsers,
  USER_OWNER_ID,
  USER_MANAGER_ID,
  USER_STAFF_RINA_ID,
  USER_STAFF_BUDI_ID,
} from "../data";
import type { ApiResult, PublicUser, Role, Session, User } from "../types";
import { delay, fail, ok } from "./_helpers";

// Mutable working copies
const users: User[] = mockUsers.map((u) => ({ ...u }));

/** In-memory session — wipes on page refresh. */
let currentSession: Session | null = null;

const SESSION_DURATION_MS: Record<Role, number> = {
  owner: 2 * 60 * 60 * 1000, // 2 hours
  manager: 2 * 60 * 60 * 1000, // 2 hours
  staff: 12 * 60 * 60 * 1000, // 12 hours (per PRD §3.3)
};

function toPublicUser(u: User): PublicUser {
  const { passwordHash, pinHash, ...rest } = u;
  return {
    ...rest,
    hasPasswordSet: passwordHash !== null,
    hasPinSet: pinHash !== null,
  };
}

function createSession(user: User): Session {
  const durationMs = SESSION_DURATION_MS[user.role];
  const expires = new Date(Date.now() + durationMs).toISOString();
  return {
    user: toPublicUser(user),
    expires,
  };
}

export async function loginWithEmailPassword(
  email: string,
  password: string,
): Promise<ApiResult<Session>> {
  await delay();

  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find(
    (u) =>
      u.email?.toLowerCase() === normalizedEmail &&
      u.deletedAt === null,
  );

  if (!user) {
    return fail("AUTH_INVALID_CREDENTIALS", "Email atau password salah");
  }
  if (user.status !== "active") {
    return fail("AUTH_ACCOUNT_DISABLED", "Akun nonaktif");
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return fail(
      "AUTH_ACCOUNT_LOCKED",
      "Akun terkunci sementara karena terlalu banyak percobaan gagal",
    );
  }
  if (user.role !== "owner" && user.role !== "manager") {
    return fail(
      "AUTH_INVALID_CREDENTIALS",
      "Login email tidak tersedia untuk role ini",
    );
  }

  // Mocks: plaintext compare. Fase B: bcrypt.compare().
  if (user.passwordHash !== password) {
    return fail("AUTH_INVALID_CREDENTIALS", "Email atau password salah");
  }

  currentSession = createSession(user);
  return ok(currentSession);
}

export async function loginWithPin(
  userId: string,
  pin: string,
): Promise<ApiResult<Session>> {
  await delay();

  const user = users.find((u) => u.id === userId && u.deletedAt === null);
  if (!user) return fail("AUTH_INVALID_CREDENTIALS", "User tidak ditemukan");
  if (user.status !== "active") {
    return fail("AUTH_ACCOUNT_DISABLED", "Akun nonaktif");
  }
  if (user.pinHash !== pin) {
    return fail("AUTH_INVALID_CREDENTIALS", "PIN salah");
  }

  currentSession = createSession(user);
  return ok(currentSession);
}

/**
 * Generate single-use approver token for restricted actions (void, refund,
 * discount) — per docs/05-ROLES-RBAC.md §6.
 */
export interface ApproverToken {
  token: string;
  expiresInSeconds: number;
}

export interface VerifyApproverInput {
  approverId: string;
  pin: string;
  actionType:
    | "pos.transaction.void"
    | "pos.transaction.refund"
    | "pos.discount.apply";
  targetEntityId?: string;
}

export async function verifyApprover(
  input: VerifyApproverInput,
): Promise<ApiResult<ApproverToken>> {
  await delay();

  const approver = users.find(
    (u) => u.id === input.approverId && u.deletedAt === null,
  );

  if (!approver || approver.status !== "active") {
    return fail("APPROVER_INVALID", "Approver tidak valid");
  }
  if (approver.role !== "owner" && approver.role !== "manager") {
    return fail(
      "APPROVER_NOT_AUTHORIZED",
      "User ini tidak berwenang approve aksi ini",
    );
  }
  if (approver.pinHash !== input.pin) {
    return fail("APPROVER_INVALID_PIN", "PIN approver salah");
  }

  // Mocks: return a simple token string; Fase B: signed JWT.
  const token = `APR-${input.actionType}-${input.approverId}-${Date.now()}`;
  return ok({ token, expiresInSeconds: 300 });
}

/**
 * List users eligible to approve overrides (for POS override modal UI).
 * Only active owners + managers, never Staff.
 */
export async function listApprovers(): Promise<ApiResult<PublicUser[]>> {
  await delay();
  const approvers = users
    .filter(
      (u) =>
        u.deletedAt === null &&
        u.status === "active" &&
        (u.role === "owner" || u.role === "manager") &&
        u.pinHash !== null,
    )
    .map(toPublicUser);
  return ok(approvers);
}

export async function getSession(): Promise<ApiResult<Session | null>> {
  await delay(50); // fast path — usually called on every page render
  if (!currentSession) return ok(null);
  if (new Date(currentSession.expires).getTime() < Date.now()) {
    currentSession = null;
    return ok(null);
  }
  return ok(currentSession);
}

export async function logout(): Promise<ApiResult<{ loggedOut: true }>> {
  await delay();
  currentSession = null;
  return ok({ loggedOut: true });
}

/** Test-only — bypass login for Storybook/dev panels. */
export function __devImpersonate(
  userKey: "owner" | "manager" | "staffRina" | "staffBudi",
): Session | null {
  const id = {
    owner: USER_OWNER_ID,
    manager: USER_MANAGER_ID,
    staffRina: USER_STAFF_RINA_ID,
    staffBudi: USER_STAFF_BUDI_ID,
  }[userKey];
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  currentSession = createSession(user);
  return currentSession;
}
