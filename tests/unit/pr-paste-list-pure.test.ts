import { describe, expect, it } from "vitest";
import {
  matchIngredient,
  normalizeUnitWord,
  parseIndonesianQty,
  parsePasteLine,
  parsePasteList,
  resolveUnitForCandidate,
  type PasteCandidate,
} from "@/features/purchase-requests/paste-list-pure";

/** Cuplikan master Mahakan yang relevan dengan nota 25 Agustus. */
const MASTER: PasteCandidate[] = [
  { id: "i1", name: "Sendok Plastik Takeaway", unit: "Pcs", packLabels: ["Pack"] },
  { id: "i2", name: "Kertas Nasi Putih", unit: "Pcs", packLabels: ["Pack"] },
  { id: "i3", name: "Kertas Dimsum", unit: "Pcs", packLabels: ["Pack"] },
  { id: "i4", name: "Sosis", unit: "Pcs", packLabels: ["Pack"] },
  { id: "i5", name: "Nugget 500gr", unit: "Pcs", packLabels: ["Pack", "Kg"] },
  { id: "i6", name: "Ayam Fillet", unit: "gr", packLabels: ["Kg"] },
  { id: "i7", name: "Bumbu Ngohiong", unit: "gr", packLabels: ["Pack"] },
  { id: "i8", name: "Gula Aren", unit: "gr", packLabels: ["Kg"] },
  { id: "i9", name: "Gula Halus", unit: "gr", packLabels: ["Kg"] },
  { id: "i10", name: "Gula Pasir Kiloan", unit: "gr", packLabels: ["Kg"] },
  { id: "i11", name: "Prep - Sambal Matah", unit: "gr", packLabels: [] },
  { id: "i12", name: "Saus Tiram", unit: "ml", packLabels: [] },
];

describe("parseIndonesianQty", () => {
  it("koma desimal, titik ribuan", () => {
    expect(parseIndonesianQty("1,5")).toBe(1.5);
    expect(parseIndonesianQty("1.500")).toBe(1500);
    expect(parseIndonesianQty("250")).toBe(250);
    expect(parseIndonesianQty("0,25")).toBe(0.25);
  });

  it("tolak yang bukan angka atau nol", () => {
    expect(parseIndonesianQty("")).toBeNull();
    expect(parseIndonesianQty("dua")).toBeNull();
    expect(parseIndonesianQty("0")).toBeNull();
    expect(parseIndonesianQty("2pck")).toBeNull();
  });
});

describe("normalizeUnitWord — ejaan sehari-hari staff", () => {
  it("pck / bks / pak semuanya Pack", () => {
    expect(normalizeUnitWord("pck")).toBe("Pack");
    expect(normalizeUnitWord("bks")).toBe("Pack");
    expect(normalizeUnitWord("Pak")).toBe("Pack");
  });

  it("kompan = jerigen (istilah dapur Mahakan)", () => {
    expect(normalizeUnitWord("kompan")).toBe("Jerigen");
  });

  it("satuan tak dikenal dibiarkan apa adanya, bukan ditebak", () => {
    expect(normalizeUnitWord("gepok")).toBe("gepok");
  });
});

describe("parsePasteLine — bentuk tulisan staff", () => {
  const p = (line: string) => parsePasteLine(line, MASTER);

  it('"1. sendok plastik - 2 pck"', () => {
    const r = p("1. sendok plastik - 2 pck")!;
    expect(r.name).toBe("sendok plastik");
    expect(r.qty).toBe(2);
    expect(r.unit).toBe("Pack");
    expect(r.match).toEqual({
      kind: "partial",
      ingredientId: "i1",
      name: "Sendok Plastik Takeaway",
    });
  });

  it('"daun bawang — 250gr" (em-dash + qty nempel satuan)', () => {
    const r = p("2. daun bawang — 250gr")!;
    expect(r.name).toBe("daun bawang");
    expect(r.qty).toBe(250);
    expect(r.unit).toBe("gr");
  });

  it('tanpa pemisah: "gula 1 kg"', () => {
    const r = p("gula 1 kg")!;
    expect(r.name).toBe("gula");
    expect(r.qty).toBe(1);
    expect(r.unit).toBe("Kg");
  });

  it('titik dua: "sosis : 1 pck"', () => {
    const r = p("sosis : 1 pck")!;
    expect(r.name).toBe("sosis");
    expect(r.qty).toBe(1);
    expect(r.match.kind).toBe("exact");
  });

  it("nama master yang MEMUAT tanda hubung tidak terpotong", () => {
    // Pemisah diambil yang paling kanan, jadi "Prep - Sambal Matah" utuh.
    const r = p("Prep - Sambal Matah - 500 gr")!;
    expect(r.name).toBe("Prep - Sambal Matah");
    expect(r.qty).toBe(500);
    expect(r.match).toMatchObject({ kind: "exact", ingredientId: "i11" });
  });

  it("baris tanpa qty tetap terbaca, qty null (staff yang isi)", () => {
    const r = p("mayonaise")!;
    expect(r.name).toBe("mayonaise");
    expect(r.qty).toBeNull();
  });
});

describe("matchIngredient", () => {
  it("nama persis → exact", () => {
    expect(matchIngredient("Sosis", MASTER)).toMatchObject({ kind: "exact" });
    expect(matchIngredient("kertas nasi putih", MASTER)).toMatchObject({
      kind: "exact",
      ingredientId: "i2",
    });
  });

  it("nama staff lebih pendek dari master → partial", () => {
    expect(matchIngredient("nugget", MASTER)).toMatchObject({
      kind: "partial",
      ingredientId: "i5",
    });
    expect(matchIngredient("ngohiong", MASTER)).toMatchObject({
      kind: "partial",
      ingredientId: "i7",
    });
  });

  it("nama staff lebih panjang dari master → partial", () => {
    expect(matchIngredient("ayam fillet paha", MASTER)).toMatchObject({
      kind: "partial",
      ingredientId: "i6",
    });
  });

  it("cocok ke banyak bahan → ambigu, JANGAN ditebak", () => {
    const m = matchIngredient("gula", MASTER);
    expect(m.kind).toBe("ambiguous");
    if (m.kind === "ambiguous") {
      expect(m.options.map((o) => o.name).sort()).toEqual([
        "Gula Aren",
        "Gula Halus",
        "Gula Pasir Kiloan",
      ]);
    }
  });

  it("tidak ada di master → none (nanti jadi item manual)", () => {
    expect(matchIngredient("saus mclewis", MASTER).kind).toBe("none");
    expect(matchIngredient("pembersih lantai", MASTER).kind).toBe("none");
  });
});

describe("resolveUnitForCandidate", () => {
  const ayam = MASTER.find((m) => m.id === "i6")!;

  it("satuan yang sah diterima", () => {
    expect(resolveUnitForCandidate("Kg", ayam)).toBe("Kg");
    expect(resolveUnitForCandidate("gr", ayam)).toBe("gr");
  });

  it("satuan asing ditolak (null), bukan dipaksakan", () => {
    expect(resolveUnitForCandidate("Pack", ayam)).toBeNull();
    expect(resolveUnitForCandidate(null, ayam)).toBeNull();
  });
});

describe("parsePasteList — tempel SELURUH pesan WhatsApp", () => {
  const PESAN = `🛒 *PERMINTAAN BELANJA — MAHAKAN*

📋 No. PR  : *REQ-E9E6C1DB*
📅 Tanggal : Selasa, 25 Agustus 2026
⏰ Jam     : 22.13 WIB
👤 Diminta : Sarah
📦 Item    : 10 bahan

*— DAFTAR BELANJA —*
 1. sendok plastik - 2 pck
 2. kertas nasi putih - 2 pck
 3. pembersih lantai - 2 kompan
 4. saus tomat - 1 pck
 5. saus mclewis - 1 pck
 6. sosis - 1 pck
 7. nugget - 1 pck
 8. ayam fillet paha - 1 kg
 9. ngohiong - 2 pck
10. gula - 1 kg

─────────────────────
_Pesan otomatis dari Mahakan POS Mobile_
_Konfirmasi approval atau pertanyaan: balas pesan ini_`;

  const hasil = parsePasteList(PESAN, MASTER);

  it("kepala & kaki pesan tidak ikut jadi item", () => {
    expect(hasil).toHaveLength(10);
    expect(hasil.map((r) => r.name)).toEqual([
      "sendok plastik",
      "kertas nasi putih",
      "pembersih lantai",
      "saus tomat",
      "saus mclewis",
      "sosis",
      "nugget",
      "ayam fillet paha",
      "ngohiong",
      "gula",
    ]);
  });

  it("qty & satuan terbaca di semua baris", () => {
    expect(hasil.map((r) => r.qty)).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 2, 1]);
    expect(hasil[2].unit).toBe("Jerigen");
    expect(hasil[7].unit).toBe("Kg");
  });

  it("6 baris tertaut master, 1 ambigu (gula), 3 perlu ditulis manual", () => {
    const n = (k: string) => hasil.filter((r) => r.match.kind === k).length;
    expect(n("exact") + n("partial")).toBe(6);
    expect(n("ambiguous")).toBe(1);
    /* pembersih lantai, saus tomat, saus mclewis — memang tidak ada padanan
     * di master, jadi dibiarkan manual alih-alih ditebak ke bahan lain. */
    expect(n("none")).toBe(3);
  });

  it("baris kosong & garis pemisah diabaikan", () => {
    expect(parsePasteList("\n\n───\n\n", MASTER)).toHaveLength(0);
  });
});

/* ======================================================================
 * Sesi AE-220 — pencocokan bertingkat + nama lain (alias).
 *
 * Semua contoh di bawah diambil dari daftar belanja NYATA staff Mahakan
 * Agustus 2026. Sebelum ini kelimanya berakhir sebagai "item manual" dan
 * akan menjadi bahan kembar kalau disimpan apa adanya ke master.
 * ==================================================================== */

const MASTER2: PasteCandidate[] = [
  { id: "a1", name: "Bawang Daun", unit: "gr", packLabels: [] },
  { id: "a2", name: "Gulaku", unit: "gr", packLabels: ["Kg"] },
  { id: "a3", name: "Saos Tomat", unit: "gr", packLabels: [] },
  { id: "a4", name: "Saos Cabai Mclewis", unit: "gr", packLabels: [] },
  { id: "a5", name: "Saos Cabai Belibis", unit: "gr", packLabels: [] },
  { id: "a6", name: "Caramel Sauce", unit: "ml", packLabels: [] },
  {
    id: "a7",
    name: "Sabun Lantai Cargloss",
    unit: "ml",
    packLabels: [],
    aliases: ["pembersih lantai"],
  },
  {
    id: "a8",
    name: "Trash Bag 90 X 120",
    unit: "Pcs",
    packLabels: [],
    aliases: ["trash bag besar"],
  },
  {
    id: "a9",
    name: "Trash Bag 60 X 100",
    unit: "Pcs",
    packLabels: [],
    aliases: ["trash bag kecil"],
  },
];

describe("matchIngredient — urutan kata & ejaan (AE-220)", () => {
  it('"daun bawang" menemukan "Bawang Daun" walau urutannya terbalik', () => {
    expect(matchIngredient("daun bawang", MASTER2)).toMatchObject({
      kind: "exact",
      ingredientId: "a1",
    });
  });

  it('"Gula ku" menemukan "Gulaku" walau ada spasi nyasar', () => {
    expect(matchIngredient("Gula ku", MASTER2)).toMatchObject({
      kind: "exact",
      ingredientId: "a2",
    });
  });

  it('ejaan "saus" vs "saos" dianggap sama', () => {
    expect(matchIngredient("saus tomat", MASTER2)).toMatchObject({
      kind: "exact",
      ingredientId: "a3",
    });
    expect(matchIngredient("saus mclewis", MASTER2)).toMatchObject({
      kind: "partial",
      ingredientId: "a4",
    });
  });

  it('"Sause caramel" menemukan "Caramel Sauce" (urutan + ejaan)', () => {
    expect(matchIngredient("Sause caramel", MASTER2)).toMatchObject({
      kind: "exact",
      ingredientId: "a6",
    });
  });

  it("kecocokan kuat tidak tenggelam oleh yang lemah", () => {
    // "saus tomat" persis = Saos Tomat. Kalau tingkatannya tidak berurutan,
    // tiga bahan ber-"saos" akan membuatnya ambigu dan menghambat staff.
    expect(matchIngredient("saus tomat", MASTER2).kind).toBe("exact");
  });
});

describe("matchIngredient — nama lain yang didaftarkan owner (AE-220)", () => {
  it('"pembersih lantai" menemukan Sabun Lantai Cargloss lewat alias', () => {
    expect(matchIngredient("pembersih lantai", MASTER2)).toMatchObject({
      kind: "exact",
      ingredientId: "a7",
    });
  });

  it("besar & kecil menunjuk trash bag yang berbeda", () => {
    expect(matchIngredient("trash bag besar", MASTER2)).toMatchObject({
      ingredientId: "a8",
    });
    expect(matchIngredient("trash bag kecil", MASTER2)).toMatchObject({
      ingredientId: "a9",
    });
  });

  it("tanpa alias, keduanya akan ambigu — inilah gunanya alias", () => {
    const tanpaAlias = MASTER2.map((c) => ({ ...c, aliases: null }));
    expect(matchIngredient("trash bag besar", tanpaAlias).kind).toBe("none");
    expect(matchIngredient("pembersih lantai", tanpaAlias).kind).toBe("none");
  });
});
