import { describe, expect, it } from "vitest";
import {
  buildStyledWorkbook,
  type StyledCol,
  type StyledSheet,
} from "@/lib/xlsx-styled";

/* Sesi AE-231 — yang gampang salah di sini cuma aritmetika BARIS: rumus per
 * baris dan rentang SUM harus menunjuk sel yang benar setelah judul,
 * subjudul, catatan, dan baris kosong ikut menggeser tabel ke bawah. Kalau
 * meleset satu baris, berkasnya tetap terbuka tapi angkanya salah diam-diam. */

interface Row {
  nama: string;
  modal: number;
}

const rows: Row[] = [
  { nama: "A", modal: 1_000 },
  { nama: "B", modal: 3_000 },
];

const cols: Array<StyledCol<Row>> = [
  { header: "Nama", value: (r) => r.nama },
  { header: "Modal", value: (r) => r.modal, fmt: "money" },
  {
    header: "% Share",
    fmt: "pct",
    total: false,
    formula: (r, ctx) => `IFERROR(B${r}/SUM($B$${ctx.firstRow}:$B$${ctx.lastRow}),0)`,
  },
];

const sheet = (over: Partial<StyledSheet<Row>> = {}): StyledSheet<never> =>
  ({
    name: "Uji",
    title: "Judul",
    subtitle: "Subjudul",
    notes: ["catatan 1"],
    cols,
    rows,
    totalRow: true,
    ...over,
  }) as unknown as StyledSheet<never>;

describe("buildStyledWorkbook", () => {
  it("tabel mulai di bawah judul + subjudul + catatan + baris kosong", async () => {
    const wb = await buildStyledWorkbook([sheet()]);
    const ws = wb.getWorksheet("Uji")!;
    // 1 judul, 2 subjudul, 3 catatan, 4 kosong, 5 kepala tabel, 6-7 data.
    expect(ws.getRow(5).getCell(1).value).toBe("Nama");
    expect(ws.getRow(6).getCell(1).value).toBe("A");
    expect(ws.getRow(7).getCell(2).value).toBe(3_000);
  });

  it("rumus per baris menunjuk barisnya sendiri & rentang data yang benar", async () => {
    const wb = await buildStyledWorkbook([sheet()]);
    const ws = wb.getWorksheet("Uji")!;
    expect(ws.getRow(6).getCell(3).value).toEqual({
      formula: "IFERROR(B6/SUM($B$6:$B$7),0)",
    });
    expect(ws.getRow(7).getCell(3).value).toEqual({
      formula: "IFERROR(B7/SUM($B$6:$B$7),0)",
    });
  });

  it("baris TOTAL memakai SUM sungguhan, bukan angka mati", async () => {
    const wb = await buildStyledWorkbook([sheet()]);
    const ws = wb.getWorksheet("Uji")!;
    const total = ws.getRow(8);
    expect(total.getCell(1).value).toBe("TOTAL");
    expect(total.getCell(2).value).toEqual({ formula: "SUM(B6:B7)" });
    // Kolom persentase tidak boleh ikut dijumlah.
    expect(total.getCell(3).value).toBeNull();
  });

  it("tanpa judul tambahan, tabel naik dan rentangnya ikut menyesuaikan", async () => {
    const wb = await buildStyledWorkbook([
      sheet({ subtitle: undefined, notes: undefined }),
    ]);
    const ws = wb.getWorksheet("Uji")!;
    // 1 judul, 2 kosong, 3 kepala, 4-5 data, 6 total.
    expect(ws.getRow(3).getCell(1).value).toBe("Nama");
    expect(ws.getRow(6).getCell(2).value).toEqual({ formula: "SUM(B4:B5)" });
  });

  it("uang & persen dapat format angka, bukan teks", async () => {
    const wb = await buildStyledWorkbook([sheet()]);
    const ws = wb.getWorksheet("Uji")!;
    expect(ws.getRow(6).getCell(2).numFmt).toContain("#,##0");
    expect(ws.getRow(6).getCell(3).numFmt).toBe("0.00%");
    expect(ws.getRow(6).getCell(1).numFmt).toBe("@");
  });

  it("kepala tabel dibekukan + lebar kolom terisi", async () => {
    const wb = await buildStyledWorkbook([sheet()]);
    const ws = wb.getWorksheet("Uji")!;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(ws.columns.every((c) => (c.width ?? 0) >= 12)).toBe(true);
  });

  it("lembar tanpa data tidak bikin rentang SUM ngawur", async () => {
    const wb = await buildStyledWorkbook([sheet({ rows: [] })]);
    const ws = wb.getWorksheet("Uji")!;
    // Kepala tabel tetap ada, baris TOTAL tidak dibuat.
    expect(ws.getRow(5).getCell(1).value).toBe("Nama");
    expect(ws.getRow(6).getCell(1).value).toBeNull();
  });

  it("nama lembar dipangkas agar sah di Excel", async () => {
    const wb = await buildStyledWorkbook([
      sheet({ name: "Rekap/Pihak: 2026 [draft] yang namanya kepanjangan" }),
    ]);
    expect(wb.worksheets[0]!.name).toHaveLength(31);
    expect(wb.worksheets[0]!.name).not.toMatch(/[:\\/?*[\]]/);
  });
});
