import { describe, it, expect, beforeAll } from "vitest";
import {
  issueApproverToken,
  consumeApproverToken,
} from "@/lib/auth/approver";

beforeAll(() => {
  // jose needs a secret available at module-eval time only when called,
  // so set before any token op.
  process.env.AUTH_SECRET = "test-secret-base64-32-bytes-long-string=";
});

describe("approver token", () => {
  it("issues then consumes for matching action+entity", async () => {
    const token = await issueApproverToken({
      approverId: "11111111-1111-1111-1111-111111111111",
      approverRole: "owner",
      actionType: "pos.transaction.void",
      targetEntityId: "22222222-2222-2222-2222-222222222222",
    });
    const consumed = await consumeApproverToken(
      token,
      "pos.transaction.void",
      "22222222-2222-2222-2222-222222222222",
    );
    expect(consumed.approverId).toBe("11111111-1111-1111-1111-111111111111");
    expect(consumed.approverRole).toBe("owner");
    expect(consumed.actionType).toBe("pos.transaction.void");
  });

  it("rejects replay (single-use)", async () => {
    const token = await issueApproverToken({
      approverId: "11111111-1111-1111-1111-111111111111",
      approverRole: "manager",
      actionType: "pos.transaction.refund",
      targetEntityId: "33333333-3333-3333-3333-333333333333",
    });
    await consumeApproverToken(
      token,
      "pos.transaction.refund",
      "33333333-3333-3333-3333-333333333333",
    );
    await expect(
      consumeApproverToken(
        token,
        "pos.transaction.refund",
        "33333333-3333-3333-3333-333333333333",
      ),
    ).rejects.toThrow(/ALREADY_USED/);
  });

  it("rejects token used for a different action", async () => {
    const token = await issueApproverToken({
      approverId: "11111111-1111-1111-1111-111111111111",
      approverRole: "owner",
      actionType: "pos.transaction.void",
      targetEntityId: null,
    });
    await expect(
      consumeApproverToken(token, "pos.discount.apply", null),
    ).rejects.toThrow(/ACTION_MISMATCH/);
  });

  it("rejects token used for a different target entity", async () => {
    const token = await issueApproverToken({
      approverId: "11111111-1111-1111-1111-111111111111",
      approverRole: "owner",
      actionType: "pos.transaction.void",
      targetEntityId: "44444444-4444-4444-4444-444444444444",
    });
    await expect(
      consumeApproverToken(
        token,
        "pos.transaction.void",
        "55555555-5555-5555-5555-555555555555",
      ),
    ).rejects.toThrow(/TARGET_MISMATCH/);
  });

  it("rejects tampered token", async () => {
    const token = await issueApproverToken({
      approverId: "11111111-1111-1111-1111-111111111111",
      approverRole: "owner",
      actionType: "pos.transaction.void",
      targetEntityId: null,
    });
    const tampered = token.slice(0, -2) + "xx";
    await expect(
      consumeApproverToken(tampered, "pos.transaction.void", null),
    ).rejects.toThrow();
  });
});
