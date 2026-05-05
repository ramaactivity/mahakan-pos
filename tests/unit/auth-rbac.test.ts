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

  it("Staff can pair + test thermal printer (operasional, not admin)", () => {
    expect(hasPermission("staff", "settings.printer.pair")).toBe(true);
    expect(hasPermission("staff", "settings.printer.test")).toBe(true);
    expect(hasPermission("staff", "settings.business.update")).toBe(false);
    expect(hasPermission("staff", "settings.hours.update")).toBe(false);
  });

  it("Inventory: Owner + Manager view + receive; Owner-only adjust + delete + cost", () => {
    expect(hasPermission("owner", "inventory.ingredient.view")).toBe(true);
    expect(hasPermission("manager", "inventory.ingredient.view")).toBe(true);
    expect(hasPermission("staff", "inventory.ingredient.view")).toBe(false);

    expect(hasPermission("manager", "inventory.receive")).toBe(true);
    expect(hasPermission("manager", "inventory.waste")).toBe(true);

    expect(hasPermission("manager", "inventory.adjust")).toBe(false);
    expect(hasPermission("owner", "inventory.adjust")).toBe(true);

    expect(hasPermission("manager", "inventory.ingredient.delete")).toBe(false);
    expect(hasPermission("manager", "inventory.cost.view")).toBe(false);
    expect(hasPermission("owner", "inventory.cost.view")).toBe(true);
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
    expect(canActOnRole("owner", "supervisor")).toBe(true);
    expect(canActOnRole("owner", "staff")).toBe(true);
  });

  it("Manager on supervisor + staff (not manager/owner)", () => {
    expect(canActOnRole("manager", "supervisor")).toBe(true);
    expect(canActOnRole("manager", "staff")).toBe(true);
    expect(canActOnRole("manager", "manager")).toBe(false);
    expect(canActOnRole("manager", "owner")).toBe(false);
  });

  it("Supervisor cannot act on any role (no user CRUD perm)", () => {
    expect(canActOnRole("supervisor", "staff")).toBe(false);
    expect(canActOnRole("supervisor", "manager")).toBe(false);
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

  it("Supervisor = 12h (frontline)", () => {
    expect(sessionMaxAgeSeconds("supervisor")).toBe(12 * 3600);
  });

  it("Owner = 2h", () => {
    expect(sessionMaxAgeSeconds("owner")).toBe(2 * 3600);
  });

  it("Manager = 2h", () => {
    expect(sessionMaxAgeSeconds("manager")).toBe(2 * 3600);
  });
});

describe("user.reset_pin per-target (sesi AC-5b regression #1)", () => {
  it("staff target → manager+supervisor allowed", () => {
    expect(hasPermission("manager", "user.reset_pin.staff")).toBe(true);
    expect(hasPermission("supervisor", "user.reset_pin.staff")).toBe(true);
  });

  it("manager/owner target → only owner allowed", () => {
    expect(hasPermission("owner", "user.reset_pin.manager")).toBe(true);
    expect(hasPermission("manager", "user.reset_pin.manager")).toBe(false);
    expect(hasPermission("supervisor", "user.reset_pin.manager")).toBe(false);
    expect(hasPermission("staff", "user.reset_pin.manager")).toBe(false);
  });

  it("canActOnRole gates manager from acting on owner", () => {
    // Defense-in-depth gate at action layer (resetPin) — even kalau perm
    // lookup salah, hierarchy gate blocks privilege escalation.
    expect(canActOnRole("manager", "owner")).toBe(false);
    expect(canActOnRole("manager", "manager")).toBe(false);
    expect(canActOnRole("manager", "supervisor")).toBe(true);
    expect(canActOnRole("manager", "staff")).toBe(true);
  });
});

describe("Supervisor (Phase 8.1 Option B, sesi AC-4)", () => {
  it("can do POS basics + shift ops + reports", () => {
    expect(hasPermission("supervisor", "pos.transaction.create")).toBe(true);
    expect(hasPermission("supervisor", "pos.transaction.void")).toBe(true);
    expect(hasPermission("supervisor", "pos.transaction.refund")).toBe(true);
    expect(hasPermission("supervisor", "shift.open_own")).toBe(true);
    expect(hasPermission("supervisor", "shift.view_all")).toBe(true);
    expect(hasPermission("supervisor", "report.sales.view")).toBe(true);
    expect(hasPermission("supervisor", "purchase_request.receive")).toBe(true);
    expect(hasPermission("supervisor", "user.reset_pin.staff")).toBe(true);
  });

  it("CANNOT touch master data (menu / inventory CRUD / supplier)", () => {
    expect(hasPermission("supervisor", "menu.item.create")).toBe(false);
    expect(hasPermission("supervisor", "menu.item.delete")).toBe(false);
    expect(hasPermission("supervisor", "inventory.ingredient.create")).toBe(
      false,
    );
    expect(hasPermission("supervisor", "supplier.create")).toBe(false);
    expect(hasPermission("supervisor", "inventory.adjust")).toBe(false);
  });

  it("CANNOT do irreversible / financial commitment actions", () => {
    expect(hasPermission("supervisor", "purchase.cancel")).toBe(false);
    expect(hasPermission("supervisor", "purchase.mark_paid")).toBe(false);
    expect(hasPermission("supervisor", "purchase_request.cancel")).toBe(false);
    expect(hasPermission("supervisor", "cash_deposit.verify")).toBe(false);
    expect(hasPermission("supervisor", "inventory.opname.finalize")).toBe(
      false,
    );
    expect(hasPermission("supervisor", "expense.delete")).toBe(false);
    expect(hasPermission("supervisor", "user.deactivate.staff")).toBe(false);
  });

  it("CANNOT view payroll or accounting (sensitive)", () => {
    expect(hasPermission("supervisor", "payroll.view")).toBe(false);
    expect(hasPermission("supervisor", "payroll.manage")).toBe(false);
    expect(hasPermission("supervisor", "accounting.coa.view")).toBe(false);
    expect(hasPermission("supervisor", "accounting.journal.view")).toBe(false);
    expect(hasPermission("supervisor", "report.pnl.view")).toBe(false);
    expect(hasPermission("supervisor", "report.cost_visibility")).toBe(false);
  });

  it("CANNOT touch settings except printer pair/test", () => {
    expect(hasPermission("supervisor", "settings.business.update")).toBe(false);
    expect(hasPermission("supervisor", "settings.printer.pair")).toBe(true);
    expect(hasPermission("supervisor", "settings.printer.test")).toBe(true);
    expect(hasPermission("supervisor", "settings.thresholds.update")).toBe(
      false,
    );
  });
});
