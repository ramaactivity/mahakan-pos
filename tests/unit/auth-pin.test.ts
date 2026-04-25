import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPinFormat } from "@/lib/auth/pin";

describe("pin format validator (C5=A: 4-6 digits)", () => {
  it.each(["1234", "12345", "123456"])("accepts %s", (pin) => {
    expect(isValidPinFormat(pin)).toBe(true);
  });

  it.each(["123", "1234567", "abcd", "12 34", "12-34", ""])(
    "rejects %s",
    (pin) => {
      expect(isValidPinFormat(pin)).toBe(false);
    },
  );
});

describe("pin hashing", () => {
  it("verifies same pin", async () => {
    const hash = await hashPin("5678");
    expect(await verifyPin("5678", hash)).toBe(true);
  });

  it("rejects wrong pin", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("4321", hash)).toBe(false);
  });
});
