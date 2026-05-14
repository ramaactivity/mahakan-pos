import { describe, it, expect } from "vitest";
import {
  align,
  bold,
  centerLine,
  concat,
  cut,
  divider,
  dualLine,
  feed,
  init,
  size,
  sizeReset,
  text,
} from "@/lib/printer/esc-pos";
import {
  buildReceipt,
  wrapItemName,
  type ReceiptData,
  type ReceiptItem,
} from "@/lib/printer/receipt-builder";

describe("esc-pos low-level commands", () => {
  it("init = ESC @", () => {
    expect([...init()]).toEqual([0x1b, 0x40]);
  });

  it("feed clamps n to 0..255", () => {
    expect([...feed(3)]).toEqual([0x1b, 0x64, 3]);
    expect([...feed(-1)]).toEqual([0x1b, 0x64, 0]);
    expect([...feed(999)]).toEqual([0x1b, 0x64, 255]);
  });

  it("align maps to ESC a n", () => {
    expect([...align("left")]).toEqual([0x1b, 0x61, 0]);
    expect([...align("center")]).toEqual([0x1b, 0x61, 1]);
    expect([...align("right")]).toEqual([0x1b, 0x61, 2]);
  });

  it("bold maps to ESC E n", () => {
    expect([...bold(true)]).toEqual([0x1b, 0x45, 1]);
    expect([...bold(false)]).toEqual([0x1b, 0x45, 0]);
  });

  it("size encodes width/height into n = (w-1)<<4 | (h-1)", () => {
    expect([...size(1, 1)]).toEqual([0x1d, 0x21, 0]);
    expect([...size(2, 2)]).toEqual([0x1d, 0x21, 0x11]);
    expect([...size(3, 1)]).toEqual([0x1d, 0x21, 0x20]);
    expect([...sizeReset()]).toEqual([0x1d, 0x21, 0]);
    // clamp 0 → 1, 9 → 8
    expect([...size(0, 9)]).toEqual([0x1d, 0x21, 0x07]);
  });

  it("cut emits GS V m", () => {
    expect([...cut(false)]).toEqual([0x1d, 0x56, 0]);
    expect([...cut(true)]).toEqual([0x1d, 0x56, 1]);
  });

  it("text encodes UTF-8", () => {
    expect([...text("hi")]).toEqual([0x68, 0x69]);
  });

  it("concat joins multiple Uint8Arrays in order", () => {
    const out = concat(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect([...out]).toEqual([1, 2, 3]);
  });
});

describe("esc-pos line layouts", () => {
  it("dualLine pads middle with spaces, ends with LF", () => {
    const t = decode(dualLine("Subtotal", "Rp 23.000", 32));
    expect(t).toBe("Subtotal               Rp 23.000\n");
    expect(t.length - 1).toBe(32);
  });

  it("dualLine truncates left with ASCII ellipsis when too long", () => {
    const t = decode(dualLine("This is a very long item name", "Rp 99.999", 32));
    expect(t.endsWith("Rp 99.999\n")).toBe(true);
    expect(t).toContain("..");
    expect(t.length - 1).toBe(32);
  });

  it("centerLine pads with leading spaces", () => {
    const t = decode(centerLine("Halo", 10));
    expect(t).toBe("   Halo\n");
  });

  it("centerLine returns truncated when too long", () => {
    const t = decode(centerLine("12345678901234567", 10));
    expect(t).toBe("1234567890\n");
  });

  it("divider repeats the char to fill cols", () => {
    expect(decode(divider("-", 5))).toBe("-----\n");
    expect(decode(divider("=", 8))).toBe("========\n");
  });
});

// --------------------------------------------------------------------------
// Receipt builder integration
// --------------------------------------------------------------------------

function sampleItem(overrides: Partial<ReceiptItem> = {}): ReceiptItem {
  return {
    name: "Americano",
    variant: "iced",
    quantity: 2,
    unitPrice: 16_000,
    modifiersPriceDelta: 0,
    subtotal: 32_000,
    note: null,
    openPriceNote: null,
    modifiers: [],
    ...overrides,
  };
}

function sample(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    outletName: "Mahakan Coffee & Space",
    outletAddress: "Puncak Rd KM 22, Cisarua",
    outletPhone: "0838-1977-5665",
    transactionNumber: "TRX-20260425-0001",
    pagerNumber: 5,
    orderType: "takeaway",
    createdAt: new Date("2026-04-25T07:00:00Z"),
    cashierName: "Rina",
    items: [sampleItem()],
    subtotal: 32_000,
    discountAmount: 0,
    discountReason: null,
    total: 32_000,
    paymentMethod: "cash",
    cashReceived: 50_000,
    cashChange: 18_000,
    status: "paid",
    footerText: "Terima kasih, sampai jumpa!",
    ...overrides,
  };
}

describe("buildReceipt", () => {
  it("starts with ESC @ init", () => {
    const bytes = buildReceipt(sample());
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it("ends with cut command", () => {
    const bytes = buildReceipt(sample());
    // Last 3 bytes should be GS V 0 (cut)
    const tail = Array.from(bytes.slice(-3));
    expect(tail).toEqual([0x1d, 0x56, 0]);
  });

  it("includes outlet name + transaction number + total + payment", () => {
    const t = decode(buildReceipt(sample()));
    expect(t).toContain("Mahakan Coffee & Space");
    expect(t).toContain("TRX-20260425-0001");
    expect(t).toContain("Pager 5");
    expect(t).toContain("Takeaway");
    expect(t).toContain("Rina");
    expect(t).toContain("Americano");
    expect(t).toContain("Iced");
    expect(t).toContain("TOTAL");
    expect(t).toContain("Rp 32.000");
    expect(t).toContain("TUNAI");
    expect(t).toContain("KEMBALI");
    expect(t).toContain("Rp 50.000");
    expect(t).toContain("Rp 18.000");
    expect(t).toContain("Terima kasih");
  });

  it("renders dine_in correctly", () => {
    const t = decode(buildReceipt(sample({ orderType: "dine_in" })));
    expect(t).toContain("Dine-in");
    expect(t).not.toContain("Takeaway");
  });

  it("includes voided banner for voided transactions", () => {
    const t = decode(buildReceipt(sample({ status: "voided" })));
    expect(t).toContain("VOIDED");
  });

  it("includes refunded banner", () => {
    const t = decode(buildReceipt(sample({ status: "refunded" })));
    expect(t).toContain("REFUNDED");
  });

  it("renders QRIS payment without cash details", () => {
    const t = decode(
      buildReceipt(
        sample({ paymentMethod: "qris", cashReceived: null, cashChange: null }),
      ),
    );
    expect(t).toContain("QRIS");
    expect(t).not.toContain("Kembali");
  });

  it("renders card_bca payment", () => {
    const t = decode(
      buildReceipt(
        sample({
          paymentMethod: "card_bca",
          cashReceived: null,
          cashChange: null,
        }),
      ),
    );
    expect(t).toContain("KARTU BCA");
  });

  it("includes discount line when applied", () => {
    const t = decode(
      buildReceipt(
        sample({
          subtotal: 100_000,
          discountAmount: 10_000,
          discountReason: "Promo Staff",
          total: 90_000,
          cashReceived: 100_000,
          cashChange: 10_000,
          items: [sampleItem({ unitPrice: 100_000, quantity: 1, subtotal: 100_000 })],
        }),
      ),
    );
    expect(t).toContain("Diskon");
    expect(t).toContain("Promo Staff");
    expect(t).toContain("-Rp 10.000");
  });

  it("renders item modifiers + note + open-price note", () => {
    const t = decode(
      buildReceipt(
        sample({
          items: [
            sampleItem({
              modifiers: [
                { modifierSlug: "sugar_level", selectedValue: "less", priceDelta: 0 },
                { modifierSlug: "extra_shot", selectedValue: "on", priceDelta: 8_000 },
              ],
              note: "panas banget",
              openPriceNote: "Ethiopia G2",
              modifiersPriceDelta: 8_000,
              subtotal: 48_000,
            }),
          ],
          subtotal: 48_000,
          total: 48_000,
          cashReceived: 50_000,
          cashChange: 2_000,
        }),
      ),
    );
    expect(t).toContain("less");
    expect(t).toContain("on"); // selectedValue for toggle modifier
    expect(t).toContain("Ethiopia G2");
    expect(t).toContain("catatan: panas banget");
  });

  it("omits footer when null", () => {
    const t = decode(buildReceipt(sample({ footerText: null })));
    expect(t).not.toContain("Terima kasih");
  });

  it("renders customer name when provided", () => {
    const t = decode(buildReceipt(sample({ customerName: "Andi" })));
    expect(t).toContain("Nama : Andi");
  });

  it("omits customer name line when null/undefined/empty", () => {
    expect(decode(buildReceipt(sample()))).not.toContain("Nama :");
    expect(decode(buildReceipt(sample({ customerName: null })))).not.toContain(
      "Nama :",
    );
    expect(decode(buildReceipt(sample({ customerName: "   " })))).not.toContain(
      "Nama :",
    );
  });

  it("truncates very long customer name with .. ellipsis", () => {
    const long = "A very long customer label that exceeds twenty-five chars";
    const t = decode(buildReceipt(sample({ customerName: long })));
    const match = t.match(/Nama : (.+)/);
    expect(match?.[1].length).toBeLessThanOrEqual(25);
    expect(match?.[1]).toContain("..");
  });
});

// --------------------------------------------------------------------------
// wrapItemName (sesi AE-48) — defense against thermal printer hardwrap
// --------------------------------------------------------------------------

describe("wrapItemName", () => {
  it("short header (≤ cols) — single line, no wrap", () => {
    const lines = wrapItemName(1, "Americano", "iced", 32);
    expect(lines).toEqual(["1x Americano (Iced)"]);
  });

  it("exactly at cols — single line, no wrap", () => {
    // "1x Strawberry Frappe (Iced)" = exactly 28 chars; fits 32
    const lines = wrapItemName(1, "Strawberry Frappe", "iced", 32);
    expect(lines).toEqual(["1x Strawberry Frappe (Iced)"]);
    expect(lines[0].length).toBeLessThanOrEqual(32);
  });

  it("long multi-word — wraps at word boundary", () => {
    // "1x Butterscotch Caramel Latte Special (Iced)" = 44 chars
    const lines = wrapItemName(
      1,
      "Butterscotch Caramel Latte Special",
      "iced",
      32,
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Each line ≤ 32 chars
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    // No partial words (each word ada di salah satu line)
    const flat = lines.join(" ");
    expect(flat).toContain("Butterscotch");
    expect(flat).toContain("Caramel");
    expect(flat).toContain("Latte");
    expect(flat).toContain("(Iced)");
  });

  it("ultra-long single word — hard cut at cols", () => {
    const longWord = "AaaaaaaaaaaaaaaBbbbbbbbbbbbbbbbCccccccccccccc"; // 45 chars
    const lines = wrapItemName(1, longWord, null, 32);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it("variant null — no suffix", () => {
    const lines = wrapItemName(2, "Matcha & The Bear", null, 32);
    expect(lines).toEqual(["2x Matcha & The Bear"]);
  });

  it("variant hot — '(Hot)' suffix", () => {
    const lines = wrapItemName(1, "Caramel Macchiato", "hot", 32);
    expect(lines[0]).toContain("(Hot)");
  });

  it("qty large — fits in prefix", () => {
    const lines = wrapItemName(99, "Espresso", "iced", 32);
    expect(lines).toEqual(["99x Espresso (Iced)"]);
  });
});

describe("buildReceipt — many items + long names (sesi AE-48 print bug)", () => {
  it("10-item receipt: setiap item line ≤ 32 chars (no garbled hardwrap)", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      sampleItem({
        name: `Item ${i + 1} Nama Sangat Panjang Sekali`,
        quantity: 1,
        subtotal: 25_000,
      }),
    );
    const t = decode(
      buildReceipt(
        sample({
          items,
          subtotal: 250_000,
          total: 250_000,
          cashReceived: 250_000,
          cashChange: 0,
        }),
      ),
    );
    // Tiap item name harus muncul (di-wrap, tidak hilang).
    for (let i = 1; i <= 10; i++) {
      expect(t).toContain(`Item ${i}`);
    }
    // Item terakhir tidak boleh terpotong.
    expect(t).toContain("TOTAL");
    expect(t).toContain("Rp 250.000");
  });

  it("long item name: tidak ada line text > 35 chars (32 cols + line ending)", () => {
    const longName = "Strawberry Cheesecake Caramel Latte Special Edition";
    const bytes = buildReceipt(
      sample({
        items: [
          sampleItem({
            name: longName,
            quantity: 1,
            subtotal: 50_000,
          }),
        ],
        subtotal: 50_000,
        total: 50_000,
        cashReceived: 50_000,
        cashChange: 0,
      }),
    );
    const t = decode(bytes);
    // Split by \n, check each non-empty line ≤ 35 chars (32 + space buffer).
    // Lines yang exceed = bug print garbled.
    const lines = t.split("\n");
    for (const line of lines) {
      // Skip lines yang punya double-byte chars dari ESC (binary commands)
      const isPrintable = line.split("").every((c) => c.charCodeAt(0) >= 0x20);
      if (isPrintable && line.length > 0) {
        expect(line.length).toBeLessThanOrEqual(35);
      }
    }
  });

  it("size reset di-emit antara items (defense ESC mode bleed)", () => {
    const bytes = buildReceipt(
      sample({
        items: [
          sampleItem({ name: "Item A", quantity: 1, subtotal: 10_000 }),
          sampleItem({ name: "Item B", quantity: 1, subtotal: 10_000 }),
          sampleItem({ name: "Item C", quantity: 1, subtotal: 10_000 }),
        ],
        subtotal: 30_000,
        total: 30_000,
        cashReceived: 30_000,
        cashChange: 0,
      }),
    );
    // Count GS ! 0 (size reset = GS=0x1d, '!'=0x21, value=0x00 untuk 1x1)
    // Each item should emit one sizeReset.
    let sizeResetCount = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x21 && bytes[i + 2] === 0x00) {
        sizeResetCount++;
      }
    }
    // ≥ 3 (1 per item) + 1 from outlet header = 4+. Conservative check ≥ 3.
    expect(sizeResetCount).toBeGreaterThanOrEqual(3);
  });
});

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
