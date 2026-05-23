import type { InferSelectModel } from "drizzle-orm";
import type { users } from "@/db/schema";
import type { Role } from "@/lib/auth";

export type User = InferSelectModel<typeof users>;
export type UserStatus = "active" | "inactive";

/** Snapshot exposed to admin UI — strips password/pin hashes, adds boolean flags. */
export interface PublicUser {
  id: string;
  outletId: string;
  name: string;
  email: string | null;
  role: Role;
  status: UserStatus;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  hasPasswordSet: boolean;
  hasPinSet: boolean;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface ListUsersOptions {
  role?: Role;
  status?: UserStatus;
  search?: string;
}

export interface CreateStaffInput {
  name: string;
  pin: string;
}

export interface CreateSupervisorInput {
  name: string;
  pin: string;
}

export interface CreateManagerInput {
  name: string;
  email: string;
  password: string;
  pin?: string;
}

export interface CreateOwnerInput {
  name: string;
  email: string;
  password: string;
  pin?: string;
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  status?: UserStatus;
  /** Set / change login email. Pass empty string to clear (only allowed if role becomes PIN-only). */
  email?: string | null;
  /** Promote/demote role. Owner-only; honors canActOnRole + Last-Owner. */
  role?: Role;
  /** New password (will be hashed). Pass empty string to clear — only allowed if role becomes PIN-only. */
  password?: string | null;
  /** New PIN (4-6 digits). */
  pin?: string;
  /** Set to true to remove existing PIN (only allowed if user has password). */
  clearPin?: boolean;
}

export interface ResetPinInput {
  userId: string;
  newPin: string;
}
