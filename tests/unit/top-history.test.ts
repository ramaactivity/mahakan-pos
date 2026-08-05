import { describe, expect, it } from "vitest";

/**
 * Sesi AE-184 — riwayat hutang dagang. Yang dijaga di sini adalah aturan
 * tampilannya (label jatuh tempo + kapan due masih bermakna), karena bagian
 * query-nya menyentuh DB dan sudah diverifikasi langsung ke produksi.
 *
 * Aturan penting: "telat sekian hari" HANYA bermakna untuk hutang yang masih
 * berjalan. Untuk yang sudah lunas/batal, sisa hari jatuh tempo tidak boleh
 * ditampilkan — dulu invoice lunas memang tidak pernah tampil sama sekali,
 * jadi kasus ini belum pernah ada.
 */

/** Mirror aturan di fetchTopHistory. */
function daysToDueFor(args: {
  dueDate: string | null;
  status: "pending_payment" | "paid" | "cancelled";
  todayIso: string;
}): number | null {
  if (!args.dueDate || args.status !== "pending_payment") return null;
  return Math.round(
    (Date.parse(`${args.dueDate}T00:00:00Z`) -
      Date.parse(`${args.todayIso}T00:00:00Z`)) /
      86_400_000,
  );
}

function formatDueLabel(days: number | null): string {
  if (days === null) return "Tanpa due";
  if (days < 0) return `Lewat ${Math.abs(days)} hari`;
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  return `${days} hari lagi`;
}

describe("riwayat hutang dagang — sisa jatuh tempo", () => {
  const todayIso = "2026-08-05";

  it("hutang berjalan: hitung sisa hari dari tanggal jatuh tempo", () => {
    expect(
      daysToDueFor({ dueDate: "2026-08-08", status: "pending_payment", todayIso }),
    ).toBe(3);
    expect(
      daysToDueFor({ dueDate: "2026-08-05", status: "pending_payment", todayIso }),
    ).toBe(0);
    expect(
      daysToDueFor({ dueDate: "2026-07-12", status: "pending_payment", todayIso }),
    ).toBe(-24);
  });

  it("sudah lunas / dibatalkan: sisa jatuh tempo TIDAK dihitung", () => {
    expect(
      daysToDueFor({ dueDate: "2026-07-12", status: "paid", todayIso }),
    ).toBeNull();
    expect(
      daysToDueFor({ dueDate: "2026-07-12", status: "cancelled", todayIso }),
    ).toBeNull();
  });

  it("tanpa tanggal jatuh tempo → null", () => {
    expect(
      daysToDueFor({ dueDate: null, status: "pending_payment", todayIso }),
    ).toBeNull();
  });

  it("label jatuh tempo terbaca manusia", () => {
    expect(formatDueLabel(-24)).toBe("Lewat 24 hari");
    expect(formatDueLabel(0)).toBe("Hari ini");
    expect(formatDueLabel(1)).toBe("Besok");
    expect(formatDueLabel(5)).toBe("5 hari lagi");
    expect(formatDueLabel(null)).toBe("Tanpa due");
  });
});
