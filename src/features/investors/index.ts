export type {
  ApiResult,
  BulkImportInvestorRow,
  BulkImportInvestorsInput,
  BulkImportInvestorsResult,
  CapitalMovement,
  CreateInvestorInput,
  Investor,
  InvestorStatus,
  InvestorWithStats,
  ListInvestorsOptions,
  Paginated,
  UpdateInvestorInput,
} from "./types";
export { isOk } from "./types";

export {
  bulkImportInvestors,
  createInvestor,
  deleteInvestor,
  getInvestor,
  getTotalModalInvestors,
  listInvestors,
  updateInvestor,
} from "./actions";
