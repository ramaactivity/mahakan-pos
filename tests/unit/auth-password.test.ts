import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies the same password against its own hash", async () => {
    const hash = await hashPassword("CorrectHorse-7!");
    expect(await verifyPassword("CorrectHorse-7!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Owner1234!");
    expect(await verifyPassword("Owner1234?", hash)).toBe(false);
  });

  it("produces different hashes for the same input (salt randomness)", async () => {
    const a = await hashPassword("Foo");
    const b = await hashPassword("Foo");
    expect(a).not.toBe(b);
    expect(await verifyPassword("Foo", a)).toBe(true);
    expect(await verifyPassword("Foo", b)).toBe(true);
  });

  it("rejects an empty password against a hashed non-empty", async () => {
    const hash = await hashPassword("real");
    expect(await verifyPassword("", hash)).toBe(false);
  });
});
