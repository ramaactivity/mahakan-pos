/**
 * Barrel export for mock service layer.
 *
 * Usage:
 *   import { menuService, authService, ... } from "@/mocks/services";
 *   const res = await menuService.listMenuItems();
 *
 * In Fase B (M8+) this module will be deleted. UI code should import
 * Server Actions from `@/features/*` instead. Keep imports focused so the
 * migration is a simple find-replace of module specifiers.
 */

export * as menuService from "./menuService";
export * as authService from "./authService";
export * as transactionService from "./transactionService";
export * as shiftService from "./shiftService";
export * as expenseService from "./expenseService";
export * as reportService from "./reportService";
export * as userService from "./userService";

// Helpers re-exported for consumers that need envelope types
export { isOk } from "./_helpers";
