// Public-facing types & runtime constants safe for client components.
// Server-only helpers live in:
//   - "@/lib/audit/logger" → logAudit, diffShallow
//   - "@/lib/audit/queries" → fetchAuditLogs
//
// Splitting the barrel prevents client components (e.g. the audit viewer
// section) from pulling in `import "server-only"` modules transitively.

export type {
  AuditLogRow,
  ListAuditLogsOptions,
} from "./queries";
export type { LogAuditInput } from "./logger";
export {
  AUDIT_EVENT_TYPES,
  type AuditEventType,
  type AuditEntityType,
  type AuditPayload,
  type AuditMetadata,
} from "./types";
