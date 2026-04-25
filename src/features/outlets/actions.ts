"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { ApiResult, Outlet } from "./types";

export async function getOwnOutlet(): Promise<ApiResult<Outlet>> {
  const session = await auth();
  if (!session) {
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "No session" },
    };
  }
  const [row] = await db
    .select()
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  if (!row) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "Outlet tidak ditemukan" },
    };
  }
  return { success: true, data: row };
}
