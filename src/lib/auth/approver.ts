import { SignJWT, jwtVerify } from "jose";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { consumedApproverTokens } from "@/db/schema";
import type { Permission } from "./rbac";

const APPROVER_TTL_SECONDS = 5 * 60;
const ISSUER = "mahakan-pos";
const AUDIENCE = "approver";

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET missing");
  return new TextEncoder().encode(raw);
}

/**
 * Probabilistic GC of expired token rows. Runs ~1% of consumes; bounded
 * delete keeps tail latency predictable. Rows are tiny so even letting them
 * accumulate for hours is harmless.
 */
async function maybeGarbageCollect() {
  if (Math.random() > 0.01) return;
  try {
    await db
      .delete(consumedApproverTokens)
      .where(lt(consumedApproverTokens.expiresAt, new Date()));
  } catch {
    // GC is opportunistic; failures must not block the consume path.
  }
}

export interface ApproverPayload {
  approverId: string;
  approverRole: "owner" | "manager";
  actionType: Permission;
  targetEntityId: string | null;
}

export async function issueApproverToken(
  payload: ApproverPayload,
): Promise<string> {
  const jti = crypto.randomUUID();
  return await new SignJWT({
    approverId: payload.approverId,
    approverRole: payload.approverRole,
    actionType: payload.actionType,
    targetEntityId: payload.targetEntityId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${APPROVER_TTL_SECONDS}s`)
    .sign(getSecret());
}

export interface ConsumedApprover {
  approverId: string;
  approverRole: "owner" | "manager";
  actionType: Permission;
  targetEntityId: string | null;
}

/**
 * Verify token signature, claims, and atomically mark single-use via DB
 * INSERT (PRIMARY KEY collision = already used). Throws on any failure —
 * caller maps to API error. The atomic INSERT closes the race that the
 * previous in-memory Map had under multi-instance Vercel serverless.
 */
export async function consumeApproverToken(
  token: string,
  expectedActionType: Permission,
  expectedTargetEntityId: string | null,
): Promise<ConsumedApprover> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const jti = payload.jti;
  if (!jti) throw new Error("APPROVER_TOKEN_NO_JTI");

  if (payload.actionType !== expectedActionType) {
    throw new Error("APPROVER_TOKEN_ACTION_MISMATCH");
  }
  if ((payload.targetEntityId ?? null) !== (expectedTargetEntityId ?? null)) {
    throw new Error("APPROVER_TOKEN_TARGET_MISMATCH");
  }

  // Atomic single-use enforcement. ON CONFLICT DO NOTHING returns 0 rows when
  // the jti was already consumed; a successful insert returns 1 row.
  const expSec = (payload.exp ?? Math.floor(Date.now() / 1000)) as number;
  const inserted = await db
    .insert(consumedApproverTokens)
    .values({
      jti,
      expiresAt: new Date(expSec * 1000),
    })
    .onConflictDoNothing()
    .returning({ jti: consumedApproverTokens.jti });

  if (inserted.length === 0) {
    throw new Error("APPROVER_TOKEN_ALREADY_USED");
  }

  // Probabilistic GC of expired rows
  void maybeGarbageCollect();

  return {
    approverId: payload.approverId as string,
    approverRole: payload.approverRole as "owner" | "manager",
    actionType: payload.actionType as Permission,
    targetEntityId: (payload.targetEntityId as string | null) ?? null,
  };
}
