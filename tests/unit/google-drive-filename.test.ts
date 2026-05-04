import { describe, expect, it } from "vitest";
import { buildFriendlyFilename } from "@/lib/google-drive/filename";

const FIXED_NOW = new Date("2026-05-04T04:12:30Z"); // 11:12 WIB

describe("buildFriendlyFilename", () => {
  it("composes timestamp + label + parts + uploader + ext", () => {
    const out = buildFriendlyFilename({
      label: "KTP",
      parts: ["Galih Rama Pratama", "KTP Pribadi"],
      uploaderName: "Rama",
      originalName: "WhatsApp_Image.jpeg",
      now: FIXED_NOW,
    });
    expect(out).toBe(
      "20260504-1112_KTP_Galih-Rama-Pratama_KTP-Pribadi_by_Rama.jpeg",
    );
  });

  it("uppercases the label, slugs spaces in parts", () => {
    const out = buildFriendlyFilename({
      label: "kontrak kerja",
      parts: ["Charlotte Hillary"],
      uploaderName: "Galih",
      originalName: "doc.pdf",
      now: FIXED_NOW,
    });
    // label trimmed/upper but spaces become dashes
    expect(out).toMatch(/^20260504-1112_KONTRAK-KERJA_Charlotte-Hillary_by_Galih\.pdf$/);
  });

  it("omits the by-uploader suffix when not provided", () => {
    const out = buildFriendlyFilename({
      label: "NOTA",
      parts: ["2026-05-04"],
      originalName: "nota.jpg",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_NOTA_2026-05-04.jpg");
  });

  it("falls back to ext from contentType when filename has no ext", () => {
    const out = buildFriendlyFilename({
      label: "STRUK",
      originalName: "image_no_ext",
      contentType: "image/png",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_STRUK.png");
  });

  it("uses 'bin' fallback when ext is too long (not a real ext) + contentType unknown", () => {
    const out = buildFriendlyFilename({
      label: "X",
      originalName: "filename.toolongtobeext",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_X.bin");
  });

  it("strips null + empty parts cleanly", () => {
    const out = buildFriendlyFilename({
      label: "DOK",
      parts: ["Alice", null, undefined, "  "],
      uploaderName: "Bob",
      originalName: "f.pdf",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_DOK_Alice_by_Bob.pdf");
  });

  it("yields no middle when parts empty", () => {
    const out = buildFriendlyFilename({
      label: "STRUK",
      parts: [],
      uploaderName: "Rama",
      originalName: "f.jpg",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_STRUK_by_Rama.jpg");
  });

  it("clips long part to 40 chars", () => {
    const longName = "x".repeat(80);
    const out = buildFriendlyFilename({
      label: "DOK",
      parts: [longName],
      originalName: "f.jpg",
      now: FIXED_NOW,
    });
    // The name part is exactly 40 chars
    expect(out).toBe(`20260504-1112_DOK_${"x".repeat(40)}.jpg`);
  });

  it("clips long uploader to 24 chars", () => {
    const longUploader = "y".repeat(60);
    const out = buildFriendlyFilename({
      label: "DOK",
      uploaderName: longUploader,
      originalName: "f.jpg",
      now: FIXED_NOW,
    });
    expect(out).toBe(`20260504-1112_DOK_by_${"y".repeat(24)}.jpg`);
  });

  it("strips emoji + non-ASCII (slug normalization)", () => {
    const out = buildFriendlyFilename({
      label: "DOK",
      parts: ["Çafé Müller 🎉"],
      originalName: "f.jpg",
      now: FIXED_NOW,
    });
    // diacritics decomposed + stripped, emoji removed, spaces → dashes
    expect(out).toContain("Cafe-Muller");
  });

  it("handles uppercase ext from filename", () => {
    const out = buildFriendlyFilename({
      label: "DOK",
      originalName: "scan.PDF",
      now: FIXED_NOW,
    });
    expect(out).toBe("20260504-1112_DOK.pdf");
  });

  it("WIB timestamp wraps correctly across midnight UTC", () => {
    // 22:30 UTC on May 3 = 05:30 WIB on May 4
    const out = buildFriendlyFilename({
      label: "DOK",
      originalName: "f.jpg",
      now: new Date("2026-05-03T22:30:00Z"),
    });
    expect(out).toBe("20260504-0530_DOK.jpg");
  });
});
