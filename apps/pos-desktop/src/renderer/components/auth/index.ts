/**
 * Auth UI components — POS desktop identity, authentication, and user management.
 */
export { LoginPage } from './login.page';
export { ForgotPasswordPage } from './forgot-password.page';
export { ResetPasswordPage } from './reset-password.page';
export { UserManagementPage } from './user-management.page';
export { AuditLogView } from './audit-log-view';
export { QuickSwitch } from './quick-switch.component';
export { StepUpModal } from './step-up-modal';
export { TwoFactorModal } from './two-factor-modal';
export { PinKeypad } from './pin-keypad.component';
export { Avatar } from './avatar.component';
export { RoleGuard, withRoleGuard } from './role-guard';
export { AuthRedirect, withAuth } from './auth-redirect';
export { LicenseRedirect } from './license-redirect';
export { ActivationRedirect } from './activation-redirect';

// Offline auth components
export { OfflineModeBanner } from './offline/offline-mode-banner';
export { PendingBlessingModal } from './offline/pending-blessing-modal';
export { SessionView } from './sessions/session-view';
