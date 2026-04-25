import { eq, and, isNull } from "drizzle-orm";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { verifyPin, isValidPinFormat } from "./pin";
import type { Role } from "./rbac";
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
 * is enforced in middleware via `sessionMaxAgeSeconds(role)` against
 * `token.iat`. See `src/middleware.ts`.
 */
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

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
        if (!parsed.success) return null;
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

        if (!row || !row.passwordHash) return null;
        if (row.role === "staff") return null;

        const ok = await verifyPassword(password, row.passwordHash);
        if (!ok) return null;

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
        if (!parsed.success) return null;
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

        if (!row || !row.pinHash) return null;

        const ok = await verifyPin(pin, row.pinHash);
        if (!ok) return null;

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
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.role = user.role;
        token.outletId = user.outletId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.role = token.role;
      session.user.outletId = token.outletId;
      return session;
    },
  },
  trustHost: true,
};
