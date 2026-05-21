import { describe, expect, it } from "vitest";

/**
 * Sesi AE-83 — regression test untuk multi-koreksi pos_sale_reversal
 * chain logic.
 *
 * Known limitation di AE-64: kalau transaksi sudah pernah di-koreksi
 * (original pos_sale.status='reversed'), step 4 di hook `if (status !==
 * 'reversed')` skip → counter round-2 jadi floating posted (no pair
 * linkage, ledger double-count).
 *
 * Fix: round-2+ harus reverse PREVIOUS correction entry (active revenue
 * entry), bukan original pos_sale.
 *
 * Test ini cover pure chain-selection logic. Hook actual butuh DB integration
 * (di-skip — pattern proyek hindari DB-bound tests).
 */

interface CorrectionLike {
  id: string;
  correctedJournalEntryId: string | null;
  approvedAt: Date | null;
  status: string;
}

/**
 * Pure helper extracted dari hooks.ts step 2 logic — given list of
 * prior corrections + current correction id, return the "active" entry id
 * that should be reversed (or null kalau fallback ke original pos_sale).
 */
export function selectEntryToReverse(
  priorCorrections: CorrectionLike[],
  currentCorrectionId: string,
  originalPosSaleEntryId: string | null,
): string | null {
  const priorActive = priorCorrections
    .filter(
      (c) =>
        c.id !== currentCorrectionId &&
        c.status === "approved" &&
        c.correctedJournalEntryId !== null &&
        c.approvedAt !== null,
    )
    .sort((a, b) => {
      const at = a.approvedAt!.getTime();
      const bt = b.approvedAt!.getTime();
      return bt - at;
    })[0];
  return priorActive?.correctedJournalEntryId ?? originalPosSaleEntryId;
}

describe("Multi-koreksi reversal chain selection (sesi AE-83)", () => {
  it("Round 1 (no prior corrections): fall back ke original pos_sale entry", () => {
    const target = selectEntryToReverse([], "correction-1", "pos-sale-entry-A");
    expect(target).toBe("pos-sale-entry-A");
  });

  it("Round 2: target = previous correction's correctedJournalEntryId, NOT original pos_sale", () => {
    const prior: CorrectionLike[] = [
      {
        id: "correction-1",
        correctedJournalEntryId: "corrected-entry-C1",
        approvedAt: new Date("2026-05-20T10:00:00Z"),
        status: "approved",
      },
    ];
    const target = selectEntryToReverse(prior, "correction-2", "pos-sale-entry-A");
    expect(target).toBe("corrected-entry-C1");
  });

  it("Round 3+: target = LATEST correction (by approvedAt DESC)", () => {
    const prior: CorrectionLike[] = [
      {
        id: "correction-1",
        correctedJournalEntryId: "corrected-entry-C1",
        approvedAt: new Date("2026-05-20T10:00:00Z"),
        status: "approved",
      },
      {
        id: "correction-2",
        correctedJournalEntryId: "corrected-entry-C2",
        approvedAt: new Date("2026-05-21T10:00:00Z"),
        status: "approved",
      },
    ];
    const target = selectEntryToReverse(prior, "correction-3", "pos-sale-entry-A");
    expect(target).toBe("corrected-entry-C2");
  });

  it("Exclude current correction from prior list (no self-reverse)", () => {
    /* Current correction already exists in DB by the time hook runs.
     * Filter must skip it to avoid self-referential reverse. */
    const prior: CorrectionLike[] = [
      {
        id: "correction-current",
        correctedJournalEntryId: "corrected-entry-current",
        approvedAt: new Date("2026-05-21T10:00:00Z"),
        status: "approved",
      },
    ];
    const target = selectEntryToReverse(
      prior,
      "correction-current",
      "pos-sale-entry-A",
    );
    expect(target).toBe("pos-sale-entry-A");
  });

  it("Skip corrections without correctedJournalEntryId (status approved but not yet journaled)", () => {
    const prior: CorrectionLike[] = [
      {
        id: "correction-1",
        correctedJournalEntryId: null,
        approvedAt: new Date("2026-05-20T10:00:00Z"),
        status: "approved",
      },
    ];
    const target = selectEntryToReverse(prior, "correction-2", "pos-sale-entry-A");
    expect(target).toBe("pos-sale-entry-A");
  });

  it("Skip rejected/cancelled corrections (only approved counts)", () => {
    const prior: CorrectionLike[] = [
      {
        id: "correction-rejected",
        correctedJournalEntryId: "corrected-entry-rejected",
        approvedAt: new Date("2026-05-20T10:00:00Z"),
        status: "rejected",
      },
    ];
    const target = selectEntryToReverse(prior, "correction-2", "pos-sale-entry-A");
    expect(target).toBe("pos-sale-entry-A");
  });

  it("No original entry + no priors → null (caller must handle)", () => {
    const target = selectEntryToReverse([], "correction-1", null);
    expect(target).toBe(null);
  });
});
