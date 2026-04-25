import "next-auth";
import "next-auth/jwt";
import type { Role } from "./rbac";

declare module "next-auth" {
  interface User {
    role: Role;
    outletId: string;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email?: string | null;
      role: Role;
      outletId: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: Role;
    outletId: string;
  }
}
