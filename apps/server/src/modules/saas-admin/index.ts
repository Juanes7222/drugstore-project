export { SaasAdminModule } from './saas-admin.module';
export { SaasAdminGuard } from './saas-admin.guard';
export type {
  PlatformOverviewResult,
  PlatformCustomersSummary,
  SaasAdminCustomerRow,
  SaasAdminCustomersResult,
  SaasAdminTrialEndingRow,
  SaasAdminTrialsEndingResult,
  CustomersQuery,
} from './services/saas-admin-overview.service';
export type {
  SaasAdminCustomerDashboard,
  SaasAdminUsersResult,
} from './services/saas-admin-customer.service';
export type {
  SaasAdminFraudAlertRow,
  SaasAdminFraudAlertsResult,
  FraudAlertsQuery,
} from './services/saas-admin-fraud.service';
export type {
  SaasAdminAccessAuditRow,
  SaasAdminAccessAuditResult,
  AccessAuditQuery,
} from './services/saas-admin-access-audit.service';
export type {
  SaasAdminRevenueResult,
  SaasAdminRevenueWindow,
  SaasAdminMonthlyRevenue,
  SaasAdminPlanDistributionRow,
  SaasAdminPaymentRow,
  SaasAdminCustomerPaymentsResult,
} from './services/saas-admin-revenue.service';
export type { SaasAdminAtRiskRow } from './services/saas-admin-at-risk.service';
export { SaasAdminPlatformAdminService } from './services/saas-admin-platform-admin.service';
export type { SaasAdminPlatformAdminRow } from './services/saas-admin-platform-admin.service';
export { SaasAdminSyncHealthService } from './services/saas-admin-sync-health.service';
export type { SaasAdminSyncHealthRow } from './services/saas-admin-sync-health.service';
