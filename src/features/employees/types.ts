import type { InferSelectModel } from "drizzle-orm";
import type {
  employeeCareerHistory,
  employees,
  employeeDocuments,
} from "@/db/schema";

export type Employee = InferSelectModel<typeof employees>;
export type EmployeeDocument = InferSelectModel<typeof employeeDocuments>;
export type EmployeeCareerHistoryEntry = InferSelectModel<
  typeof employeeCareerHistory
>;

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "freelance";

export type EmployeeStatus =
  | "active"
  | "on_leave"
  | "resigned"
  | "terminated";

export type DocumentType =
  | "ktp"
  | "bpjs_kesehatan"
  | "bpjs_ketenagakerjaan"
  | "npwp"
  | "ijazah"
  | "kontrak"
  | "other";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

/** Employee record joined with optional linked-user info + recent docs
 * count, used by AdminEmployeesSection list. */
export interface EmployeeWithLink extends Employee {
  linkedUserName: string | null;
  linkedUserEmail: string | null;
  documentsCount: number;
}

export interface CreateEmployeeInput {
  fullName: string;
  nickname?: string | null;
  nik?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  dateOfBirth?: string | null; // YYYY-MM-DD
  employeeNumber?: string | null;
  position?: string | null;
  department?: string | null;
  hireDate?: string | null;
  employmentType?: EmploymentType | null;
  salaryAmount?: number | null;
  userId?: string | null;
  notes?: string | null;
}

export interface UpdateEmployeeInput extends CreateEmployeeInput {
  id: string;
  status?: EmployeeStatus;
  resignedAt?: string | null;
  resignReason?: string | null;
}

export interface CreateEmployeeDocumentInput {
  employeeId: string;
  docType: DocumentType;
  title: string;
  fileUrl?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}

export interface UpdateEmployeeDocumentInput
  extends CreateEmployeeDocumentInput {
  id: string;
}
