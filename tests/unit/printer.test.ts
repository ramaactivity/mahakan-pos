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
});

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
