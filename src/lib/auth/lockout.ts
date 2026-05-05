/**
 * Brute-force lockout helper — reused antara NextAuth login flow + standalone
 * PIN endpoints (mis. /api/v1/auth/verify-approver). Sebelumnya logic ini
 * inline di config.ts dan tidak dipakai approver endpoint = approver PIN
 * bisa di-brute-force tanpa lockout (sesi AC-5b ramaactivity/code-review).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/** After this many consecutive failed attempts, lock the account briefly. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Lock duration applied when failedAttempts hits the cap. */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export async function recordFailedAttempt(
  userId: string,
  currentAttempts: number,
): Promise<{ attempts: number; locked: boolean }> {
  const next = currentAttempts + 1;
  const lockedUntil =
    next >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS) : null;
  await db
    .update(users)
    .set({ failedAttempts: next, lockedUntil })
    .where(eq(users.id, userId));
  return { attempts: next, locked: !!lockedUntil };
}

export async function clearFailedAttempts(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(users.id, userId));
}

/** True kalau user sedang locked (saat ini < lockedUntil). */
export function isLocked(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil > new Date();
}
