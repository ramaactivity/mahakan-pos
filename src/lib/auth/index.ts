import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export { hasPermission, requirePermission, sessionMaxAgeSeconds } from "./rbac";
export type { Role, Permission } from "./rbac";
