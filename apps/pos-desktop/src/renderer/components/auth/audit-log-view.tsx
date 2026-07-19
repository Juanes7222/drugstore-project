/**
 * Audit log view — re-exports the redesigned timeline view from
 * src/renderer/components/audit/.
 *
 * Kept at the original import path so existing references
 * (auth/index.ts, screen router) continue to work without changes.
 */
export { AuditLogView } from '../audit/audit-log-view';
