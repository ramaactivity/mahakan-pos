import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn() — tailwind class merger", () => {
  it("joins truthy strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });

  it("supports conditional with object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});
