import { describe, expect, it } from "vitest";
import {
  affectsDrawer,
  BACKOFFICE_ORIGIN,
  POS_ORIGIN,
} from "@/features/cash/drawer-origin";

/* Sesi AE-227 — arahan owner: "data input manual dari dashboard langsung
 * mengurangi pada POS kasir, jadi laporan dari kasir jangan diganggu sama
 * dashboard perhitungannya."
 *
 * `affectsDrawer` adalah satu-satunya tempat aturan itu ditulis. Kalau
 * jawabannya bergeser, Kas Harusnya kasir ikut bergeser — jadi tiap
 * kemungkinan nilainya dikunci di sini. */

describe("affectsDrawer", () => {
  it("entry dari POS memotong/menambah laci kasir", () => {
    expect(affectsDrawer(POS_ORIGIN)).toBe(true);
  });

  it("entry dari dashboard TIDAK pernah menyentuh laci kasir", () => {
    expect(affectsDrawer(BACKOFFICE_ORIGIN)).toBe(false);
  });

  it("baris lama (NULL) tetap dihitung sebagai isi laci", () => {
    /* Baris sebelum sesi AE-227 tidak punya asal. Kalau dianggap bukan laci,
     * seluruh riwayat petty cash hilang dari laporan dan rincian shift yang
     * sudah tertutup tidak lagi menjumlah ke variance yang ter-persist. */
    expect(affectsDrawer(null)).toBe(true);
    expect(affectsDrawer(undefined)).toBe(true);
  });

  it("nilai asing diperlakukan BUKAN laci — gagal ke arah yang aman", () => {
    /* Kalau suatu saat ada nilai baru (mis. 'import'), yang benar adalah TIDAK
     * mengganggu angka kasir sampai ada yang memutuskan sebaliknya. */
    expect(affectsDrawer("import")).toBe(false);
    expect(affectsDrawer("")).toBe(false);
    expect(affectsDrawer("POS")).toBe(false);
  });

  it("konstanta asal tidak berubah — nilainya tersimpan di DB", () => {
    /* Kolom `entry_origin` menyimpan string ini apa adanya; menggantinya
     * membuat baris lama tidak cocok lagi dengan filter query. */
    expect(POS_ORIGIN).toBe("pos");
    expect(BACKOFFICE_ORIGIN).toBe("backoffice");
  });
});

/* Cermin aturan resolusi di createExpense/createIncome: apa pun yang tidak
 * menyebut dirinya "pos" jadi backoffice. Ditulis sebagai tes supaya jalur
 * baru yang lupa mengirim asal tidak diam-diam ikut memotong laporan kasir. */
function resolveOrigin(input: string | undefined) {
  return input === POS_ORIGIN ? POS_ORIGIN : BACKOFFICE_ORIGIN;
}

describe("resolusi asal saat entry dibuat", () => {
  it("hanya POS yang menghasilkan 'pos'", () => {
    expect(resolveOrigin("pos")).toBe("pos");
  });

  it("tidak mengirim asal = dashboard, bukan laci", () => {
    expect(resolveOrigin(undefined)).toBe("backoffice");
    expect(resolveOrigin("backoffice")).toBe("backoffice");
  });

  it("hasil resolusi tidak pernah null — kolomnya tidak punya default DB", () => {
    for (const v of [undefined, "pos", "backoffice", "entah"]) {
      expect(affectsDrawer(resolveOrigin(v as string | undefined))).toBe(
        v === "pos",
      );
    }
  });
});
