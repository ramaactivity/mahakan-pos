export type {
  ApiResult,
  BillBucket,
  BillBucketKey,
  BillPerformanceReport,
  BillRow,
  BillStats,
  CategoryBreakdown,
  ClosingShiftReport,
  ClosingShiftRow,
  DailySalesReport,
  HourlyBucket,
  ItemPerformanceRow,
  MenuEngineeringResult,
  MenuEngineeringRow,
  MenuQuadrant,
  PaymentMethodBreakdown,
  PnlReport,
  SalesRangeReport,
  TopItem,
  HppReport,
  HppReportRow,
  PurchaseRollupCell,
  PurchaseRollupReport,
} from "./types";
export { isOk } from "./types";

export {
  computeBillStats,
  computeProgress,
  aggregateClosingShifts,
  BILL_BUCKET_THRESHOLDS,
  type ProgressResult,
  type ProgressTier,
} from "./bill-targets-pure";

export {
  getBillPerformanceReport,
  getClosingShiftReport,
  getDailySalesReport,
  getItemPerformance,
  getMenuEngineeringMatrix,
  getPnlReport,
  getSalesRangeReport,
  getHppReport,
  getPurchaseRollupReport,
} from "./actions";
