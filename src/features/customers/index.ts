export type {
  ApiResult,
  Customer,
  FindOrCreateCustomerInput,
  ListCustomersOptions,
  ListCustomersResult,
  UpdateCustomerInput,
} from "./types";
export {
  POINTS_PER_RUPIAH,
  RUPIAH_PER_POINT_REDEEMED,
  clampRedemption,
  computePointsEarned,
  computeRedemptionAmount,
  isOk,
  normalisePhone,
} from "./types";

/* Catatan: internal loyalty helpers (bumpCustomerEarnInTx,
 * bumpCustomerRedeemInTx, earnPointsForTransaction,
 * restorePointsOnTransactionRefund) SENGAJA tidak di-re-export dari sini —
 * mereka server-only (./loyalty-internal) dan index ini di-import client
 * components. Server callers import langsung dari
 * "@/features/customers/loyalty-internal". */
export {
  customerStats,
  findOrCreateCustomer,
  getCustomer,
  listCustomers,
  lookupCustomerByPhone,
  topCustomers,
  updateCustomer,
} from "./actions";
