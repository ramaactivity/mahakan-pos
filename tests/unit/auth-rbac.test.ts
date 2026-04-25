import { describe, it, expect } from "vitest";
import {
  hasPermission,
  requirePermission,
  sessionMaxAgeSeconds,
} from "@/lib/auth/rbac";
import { canActOnRole } from "@/lib/auth/rbac";

describe("hasPermission", () => {
  it("Owner has all permissions sampled", () => {
    expect(hasPermission("owner", "report.pnl.view")).toBe(true);
    expect(hasPermission("owner", "user.create.staff")).toBe(true);
    expect(hasPermission("owner", "settings.business.update")).toBe(true);
  });

  it("Manager lacks Owner-only permissions", () => {
    expect(hasPermission("manager", "report.pnl.view")).toBe(false);
    expect(hasPermission("manager", "user.create.owner")).toBe(false);
    expect(hasPermission("manager", "expense.delete")).toBe(false);
  });

  it("Staff cannot void/refund/discount", () => {
    expect(hasPermission("staff", "pos.transaction.void")).toBe(false);
    expect(hasPermission("staff", "pos.transaction.refund")).toBe(false);
    expect(hasPermission("staff", "pos.discount.apply")).toBe(false);
  });

  it("Staff can do POS basics", () => {
    expect(hasPermission("staff", "pos.transaction.create")).toBe(true);
    expect(hasPermission("staff", "shift.open_own")).toBe(true);
    expect(hasPermission("staff", "pos.menu.mark_sold_out")).toBe(true);
  });
});

describe("requirePermission", () => {
  it("does not throw when allowed", () => {
    expect(() =>
      requirePermission("owner", "settings.business.update"),
    ).not.toThrow();
  });

  it("throws when denied", () => {
    expect(() => requirePermission("staff", "pos.transaction.void")).toThrow(
      /Forbidden/,
    );
  });
});

describe("canActOnRole", () => {
  it("Owner can act on any role", () => {
    expect(canActOnRole("owner", "owner")).toBe(true);
    expect(canActOnRole("owner", "manager")).toBe(true);
    expect(canActOnRole("owner", "staff")).toBe(true);
  });

  it("Manager only on staff", () => {
    expect(canActOnRole("manager", "staff")).toBe(true);
    expect(canActOnRole("manager", "manager")).toBe(false);
    expect(canActOnRole("manager", "owner")).toBe(false);
  });

  it("Staff cannot act on others", () => {
    expect(canActOnRole("staff", "staff")).toBe(false);
    expect(canActOnRole("staff", "manager")).toBe(false);
  });
});

describe("sessionMaxAgeSeconds (C2=A)", () => {
  it("Staff = 12h", () => {
    expect(sessionMaxAgeSeconds("staff")).toBe(12 * 3600);
  });

  it("Owner = 2h", () => {
    expect(sessionMaxAgeSeconds("owner")).toBe(2 * 3600);
  });

  it("Manager = 2h", () => {
    expect(sessionMaxAgeSeconds("manager")).toBe(2 * 3600);
  });
});
