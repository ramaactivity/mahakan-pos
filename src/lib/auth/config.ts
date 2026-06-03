import { eq, and, isNull } from "drizzle-orm";
import type { NextAuthConfig } from "next-auth";
import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { logAudit } from "@/lib/audit/logger";
import { verifyPassword } from "./password";
import { verifyPin, isValidPinFormat } from "./pin";
import { sessionMaxAgeSeconds, type Role } from "./rbac";
import "./types";

const emailPasswordSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

const pinSchema = z.object({
  userId: z.uuid(),
  pin: z
    .string()
    .refine(isValidPinFormat, "PIN harus 4-6 digit angka"),
});

/**
 * Cookie maxAge = 12h (longest tier per C2). Per-role expiry (Owner/Manager 2h)
 * is enforced in proxy (Next 16 middleware) via `sessionMaxAgeSeconds(role)`
 * against `token.iat`. See `src/proxy.ts`.
 */
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

// Lockout helpers extracted to ./lockout for reuse oleh approver endpoint.
import {
  recordFailedAttempt,
  clearFailedAttempts,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
} from "./lockout";

/**
 * Error login dengan `code` yang sampai ke client lewat `signIn(...).code`
 * (lihat @auth/core: `params.set("code", error.code)`). Dipakai supaya UI
 * bisa membedakan "akun terkunci" vs "password salah" — sebelumnya semua
 * kasus return null → pesan generik "Email atau password salah" yang
 * menyesatkan (insiden HR Bayu: akun terkunci tapi terbaca seolah salah pwd).
 *
 * ⚠ `code` masuk ke URL — JANGAN taruh info sensitif. Hanya pakai untuk akun
 * yang email+password-nya memang valid & aktif (enumeration sudah terjadi di
 * level "email ada"), konsisten dengan recordFailedAttempt yang juga hanya
 * jalan untuk akun tsb.
 *   - `locked:<menit>`  → akun terkunci sementara, sisa X menit
 *   - `invalid:<sisa>`  → password salah, sisa X percobaan sebelum terkunci
 * Kasus no-user / no-credential / staff TETAP return null → code "credentials"
 * → UI tampilkan pesan generik (tidak membocorkan keberadaan akun).
 */
class LoginError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      id: "email-password",
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = emailPasswordSchema.safeParse(raw);
        if (!parsed.success) {
          await logAudit({
            eventType: "auth.login.failed",
            entityType: "session",
            payload: { context: { method: "email-password", reason: "invalid-input" } },
          });
          return null;
        }
        const { email, password } = parsed.data;

        const [row] = await db
          .select()
          .from(users)
          .where(
            and(
              eq(users.email, email.toLowerCase()),
              eq(users.status, "active"),
              isNull(users.deletedAt),
            ),
          )
          .limit(1);

        if (!row || !row.passwordHash || row.role === "staff") {
          await logAudit({
            eventType: "auth.login.failed",
            userId: row?.id ?? null,
            entityType: "session",
            payload: {
              context: {
                method: "email-password",
                email: email.toLowerCase(),
                reason: !row ? "no-user" : "no-credential",
              },
            },
          });
          return null;
        }

        if (row.lockedUntil && row.lockedUntil > new Date()) {
          await logAudit({
            eventType: "auth.login.failed",
            userId: row.id,
            entityType: "session",
            payload: {
              context: {
                method: "email-password",
                reason: "locked",
                lockedUntil: row.lockedUntil.toISOString(),
              },
            },
            metadata: { outletId: row.outletId, actorRole: row.role },
          });
          const mins = Math.max(
            1,
            Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000),
          );
          throw new LoginError(`locked:${mins}`);
        }

        const ok = await verifyPassword(password, row.passwordHash);
        if (!ok) {
          const r = await recordFailedAttempt(row.id, row.failedAttempts);
          await logAudit({
            eventType: "auth.login.failed",
            userId: row.id,
            entityType: "session",
            payload: {
              context: {
                method: "email-password",
                reason: "wrong-password",
                attempt: r.attempts,
                locked: r.locked,
              },
            },
            metadata: { outletId: row.outletId, actorRole: row.role },
          });
          if (r.locked) {
            throw new LoginError(`locked:${Math.ceil(LOCK_DURATION_MS / 60_000)}`);
          }
          throw new LoginError(
            `invalid:${Math.max(0, MAX_FAILED_ATTEMPTS - r.attempts)}`,
          );
        }

        if (row.failedAttempts > 0 || row.lockedUntil) {
          await clearFailedAttempts(row.id);
        }
        await logAudit({
          eventType: "auth.login.success",
          userId: row.id,
          entityType: "session",
          payload: {
            summary: `Login ${row.role} (email): ${row.name}`,
            context: { method: "email-password" },
          },
          metadata: { outletId: row.outletId, actorRole: row.role },
        });

        return {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role as Role,
          outletId: row.outletId,
        };
      },
    }),
    Credentials({
      id: "pin",
      name: "PIN",
      credentials: {
        userId: { label: "User ID", type: "text" },
        pin: { label: "PIN", type: "password" },
      },
      async authorize(raw) {
        const parsed = pinSchema.safeParse(raw);
        if (!parsed.success) {
          await logAudit({
            eventType: "auth.login.failed",
            entityType: "session",
            payload: { context: { method: "pin", reason: "invalid-input" } },
          });
          return null;
        }
        const { userId, pin } = parsed.data;

        const [row] = await db
          .select()
          .from(users)
          .where(
            and(
              eq(users.id, userId),
              eq(users.status, "active"),
              isNull(users.deletedAt),
            ),
          )
          .limit(1);

        if (!row || !row.pinHash) {
          await logAudit({
            eventType: "auth.login.failed",
            userId: row?.id ?? null,
            entityType: "session",
            payload: {
              context: {
                method: "pin",
                userId,
                reason: !row ? "no-user" : "no-credential",
              },
            },
          });
          return null;
        }

        if (row.lockedUntil && row.lockedUntil > new Date()) {
          await logAudit({
            eventType: "auth.login.failed",
            userId: row.id,
            entityType: "session",
            payload: {
              context: {
                method: "pin",
                reason: "locked",
                lockedUntil: row.lockedUntil.toISOString(),
              },
            },
            metadata: { outletId: row.outletId, actorRole: row.role },
          });
          const mins = Math.max(
            1,
            Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000),
          );
          throw new LoginError(`locked:${mins}`);
        }

        const ok = await verifyPin(pin, row.pinHash);
        if (!ok) {
          const r = await recordFailedAttempt(row.id, row.failedAttempts);
          await logAudit({
            eventType: "auth.login.failed",
            userId: row.id,
            entityType: "session",
            payload: {
              context: {
                method: "pin",
                reason: "wrong-pin",
                attempt: r.attempts,
                locked: r.locked,
              },
            },
            metadata: { outletId: row.outletId, actorRole: row.role },
          });
          if (r.locked) {
            throw new LoginError(`locked:${Math.ceil(LOCK_DURATION_MS / 60_000)}`);
          }
          throw new LoginError(
            `invalid:${Math.max(0, MAX_FAILED_ATTEMPTS - r.attempts)}`,
          );
        }

        if (row.failedAttempts > 0 || row.lockedUntil) {
          await clearFailedAttempts(row.id);
        }
        await logAudit({
          eventType: "auth.login.success",
          userId: row.id,
          entityType: "session",
          payload: {
            summary: `Login ${row.role} (PIN): ${row.name}`,
            context: { method: "pin" },
          },
          metadata: { outletId: row.outletId, actorRole: row.role },
        });

        return {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role as Role,
          outletId: row.outletId,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const userId =
        "token" in message && message.token
          ? (message.token.userId as string | undefined)
          : undefined;
      if (!userId) return;
      await logAudit({
        eventType: "auth.logout",
        userId,
        entityType: "session",
        payload: { summary: "Logout" },
      });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (user) {
        token.userId = user.id as string;
        token.role = user.role;
        token.outletId = user.outletId;
        token.roleExp = nowSec + sessionMaxAgeSeconds(user.role);
      } else if (token.role) {
        // Sliding expiry: every request that successfully decodes the token
        // pushes roleExp forward. Active users stay logged in; inactive users
        // expire after sessionMaxAgeSeconds(role) of silence. Cookie maxAge
        // (12h) is the hard cap regardless. Without sliding the window, any
        // session older than the role's window forces a re-login mid-shift —
        // which is what was breaking Owner during multi-hour back-office work.
        token.roleExp = nowSec + sessionMaxAgeSeconds(token.role);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.role = token.role;
      session.user.outletId = token.outletId;
      session.roleExp = token.roleExp;
      return session;
    },
  },
  trustHost: true,
};
