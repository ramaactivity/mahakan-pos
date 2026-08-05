// Pure mapping functions (no DB I/O). All testable as plain functions.
export { mapPosSale } from "./posSale";
export type { PosSaleInput, SplitPaymentRow } from "./posSale";
export { mapPosRefund } from "./posRefund";
export type { PosRefundInput } from "./posRefund";
export { mapPosCompliment } from "./posCompliment";
export type { PosComplimentInput } from "./posCompliment";
export { mapPayrollPaid } from "./payrollPaid";
export type { PayrollPaidInput } from "./payrollPaid";
export {
  mapCashDepositVerified,
  mapCashDepositUnverified,
  resolveBankCodeFromDestination,
} from "./cashDeposit";
export type { CashDepositVerifiedInput } from "./cashDeposit";
export {
  mapAggregatorSettlement,
  isPiutangChannel,
  defaultBankCodeForChannel,
  piutangCodeForChannel,
} from "./aggregatorSettlement";
export type {
  AggregatorChannel,
  AggregatorSettlementInput,
} from "./aggregatorSettlement";
export {
  mapShiftVariance,
  mapShiftVarianceReversal,
} from "./shiftVariance";
export type { ShiftVarianceInput } from "./shiftVariance";
export {
  mapPosSaleReversal,
  mapPosSaleCorrection,
} from "./posSaleReversal";
export type {
  PosSaleReversalInput,
  PosSaleCorrectionInput,
} from "./posSaleReversal";
export {
  mapCategoryToAccounts,
  aggregateByCategory,
} from "./categoryMapper";
export type {
  CategoryAccountMapping,
  AggregatedItem,
  CategoryAggregateResult,
} from "./categoryMapper";
export {
  mapPurchaseCreate,
  mapPurchasePay,
  mapPurchaseCancel,
} from "./purchase";
export type {
  PurchasePaymentMethod,
  IngredientSection,
  PurchaseLineAggregate,
  PurchaseCreateInput,
  PurchasePayInput,
  PurchaseCancelInput,
} from "./purchase";
export { mapExpenseCreate, expenseCashBankCode } from "./expense";
export type {
  ExpensePaymentMethod,
  ExpenseCreateInput,
} from "./expense";
export { mapIncomeCreate, incomeCashBankCode } from "./income";
export type {
  IncomePaymentMethod,
  IncomeCreateInput,
} from "./income";
export { mapOpnameAdjustment } from "./opname";
export type {
  OpnameSectionDiff,
  OpnameAdjustmentInput,
} from "./opname";
export {
  mapOpeningBalance,
  computeOpeningBalanceTotals,
} from "./openingBalance";
export type { OpeningBalanceInput } from "./openingBalance";
export { mapPeriodClose } from "./periodClose";
export type { PeriodCloseInput, AccountBalance } from "./periodClose";
export {
  mapCapitalizeAsset,
  mapMonthlyDepreciation,
  computeMonthlyDepreciation,
} from "./fixedAsset";
export type {
  CapitalizeAssetPaymentMethod,
  CapitalizeAssetInput,
  DepreciationLineInput,
  MonthlyDepreciationInput,
} from "./fixedAsset";
