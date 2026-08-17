import { describe, expect, it } from "vitest";
import {
  planAutoBalance,
  type BalanceLine,
  type SideLocks,
} from "@/features/accounting/journal-balance-pure";

/* Sesi AE-204 — penyeimbang otomatis Entry Jurnal Manual.
 * Arahan owner: isi debit → kredit ikut terisi nominal sama, dan sebaliknya. */

function line(
  id: string,
  debit = "0",
  credit = "0",
  accountId: string | null = null,
): BalanceLine {
  return { id, accountId, debit, credit };
}

const FREE: SideLocks = { lockDebit: false, lockCredit: false };
/** Akun Beban: normal DR, kolom Credit terkunci. */
const BEBAN: SideLocks = { lockDebit: false, lockCredit: true };

describe("planAutoBalance", () => {
  it("isi debit baris 1 → kredit baris 2 ikut nominal yang sama", () => {
    const lines = [line("a", "1280740"), line("b")];
    const res = planAutoBalance(lines, "a", null);
    expect(res.lines[1]).toMatchObject({ debit: "0", credit: "1280740" });
    expect(res.autoLineId).toBe("b");
  });

  it("isi kredit baris 1 → debit baris 2 ikut (arah sebaliknya)", () => {
    const lines = [line("a", "0", "500000"), line("b")];
    const res = planAutoBalance(lines, "a", null);
    expect(res.lines[1]).toMatchObject({ debit: "500000", credit: "0" });
    expect(res.autoLineId).toBe("b");
  });

  it("ketik ulang nominal → baris penyeimbang ikut berubah, bukan nambah baris baru", () => {
    const first = planAutoBalance([line("a", "100"), line("b")], "a", null);
    expect(first.lines[1]).toMatchObject({ credit: "100" });
    const retyped = first.lines.map((l) =>
      l.id === "a" ? { ...l, debit: "250" } : l,
    );
    const res2 = planAutoBalance(retyped, "a", first.autoLineId);
    expect(res2.lines[1]).toMatchObject({ debit: "0", credit: "250" });
    expect(res2.autoLineId).toBe("b");
  });

  it("hapus nominal jadi 0 → penyeimbang ikut nol lagi", () => {
    const lines = [line("a", "0"), line("b", "0", "100")];
    const res = planAutoBalance(lines, "a", "b");
    expect(res.lines[1]).toMatchObject({ debit: "0", credit: "0" });
  });

  it("angka yang diketik manual di baris lain TIDAK pernah ditimpa", () => {
    /* Dua-duanya sudah diisi tangan → sistem diam saja. */
    const lines = [line("a", "300"), line("b", "0", "999")];
    const res = planAutoBalance(lines, "a", null);
    expect(res.lines[1]).toMatchObject({ credit: "999" });
    expect(res.autoLineId).toBeNull();
  });

  it("baris penyeimbang yang diketik manual lepas dari kendali sistem", () => {
    const lines = [line("a", "100"), line("b", "0", "70")];
    const res = planAutoBalance(lines, "b", "b");
    expect(res.lines[1]).toMatchObject({ credit: "70" });
    expect(res.autoLineId).toBeNull();
  });

  it("3 baris: baris kosong menutup sisa selisih, bukan sekadar meniru satu baris", () => {
    const lines = [line("a", "100"), line("b", "40"), line("c")];
    const res = planAutoBalance(lines, "b", "c");
    expect(res.lines[2]).toMatchObject({ debit: "0", credit: "140" });
  });

  it("sisa selisih berbalik arah → penyeimbang pindah kolom", () => {
    const lines = [line("a", "0", "500"), line("b", "200"), line("c")];
    const res = planAutoBalance(lines, "b", "c");
    expect(res.lines[2]).toMatchObject({ debit: "300", credit: "0" });
  });

  it("akun Beban tidak dipaksa diisi di kolom Credit yang terkunci", () => {
    const lines = [line("a", "1000"), line("b", "0", "0", "acc-beban")];
    const res = planAutoBalance(lines, "a", null, (id) =>
      id === "acc-beban" ? BEBAN : FREE,
    );
    expect(res.lines[1]).toMatchObject({ debit: "0", credit: "0" });
    expect(res.autoLineId).toBeNull();
  });

  it("nilai non-numerik diperlakukan nol, tidak bikin NaN", () => {
    const lines = [line("a", "abc"), line("b")];
    const res = planAutoBalance(lines, "a", null);
    expect(res.lines[1]).toMatchObject({ debit: "0", credit: "0" });
  });
});
