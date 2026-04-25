import { SignJWT, jwtVerify } from "jose";
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
 * In-memory single-use blacklist. Single-instance OK for Phase 1; if we
 * ever multi-instance, swap to Redis or DB-backed (`audit_logs.jti` index).
 */
const consumedJtis = new Map<string, number>();

function purgeExpired() {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of consumedJtis) {
    if (exp <= now) consumedJtis.delete(jti);
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
 * Verify token signature, claims, single-use status. Marks jti consumed
 * before returning. Throws on any failure — caller maps to API error.
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

  purgeExpired();
  if (consumedJtis.has(jti)) throw new Error("APPROVER_TOKEN_ALREADY_USED");

  if (payload.actionType !== expectedActionType) {
    throw new Error("APPROVER_TOKEN_ACTION_MISMATCH");
  }
  if ((payload.targetEntityId ?? null) !== (expectedTargetEntityId ?? null)) {
    throw new Error("APPROVER_TOKEN_TARGET_MISMATCH");
  }

  consumedJtis.set(jti, payload.exp ?? Math.floor(Date.now() / 1000));

  return {
    approverId: payload.approverId as string,
    approverRole: payload.approverRole as "owner" | "manager",
    actionType: payload.actionType as Permission,
    targetEntityId: (payload.targetEntityId as string | null) ?? null,
  };
}
