"use server";

import { auth } from "@/lib/auth";
import { fetchPosCrew } from "./server";
import type { PosCrew } from "./types";

/** Sesi AE-235 — chip list for the POS crew picker. */
export async function listPosCrew(): Promise<PosCrew[]> {
  const session = await auth();
  if (!session) return [];
  return fetchPosCrew(session.user.outletId);
}
