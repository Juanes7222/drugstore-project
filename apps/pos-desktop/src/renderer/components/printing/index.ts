/**
 * Barrel exports for printing presentational components.
 *
 * Re-exports every named component and its props interface so that
 * wiring containers (page.tsx files) import from a single entry point.
 */

export { PrinterStatusBadge } from './printer-status-badge';
export type { PrinterStatusBadgeProps } from './printer-status-badge';

export { QueueSummaryBar } from './queue-summary-bar';
export type { QueueSummaryBarProps } from './queue-summary-bar';

export { PrinterCard } from './printer-card';
export type { PrinterCardProps } from './printer-card';

export { PrintJobRow } from './print-job-row';
export type { PrintJobRowProps } from './print-job-row';

export { SetupWizardStepWelcome } from './setup-wizard-step-welcome';
export type { SetupWizardStepWelcomeProps } from './setup-wizard-step-welcome';

export { SetupWizardStepDiscovery } from './setup-wizard-step-discovery';
export type { SetupWizardStepDiscoveryProps } from './setup-wizard-step-discovery';

export { SetupWizardStepFoundPrinters } from './setup-wizard-step-found-printers';
export type { SetupWizardStepFoundPrintersProps } from './setup-wizard-step-found-printers';

export { SetupWizardStepJobAssignment } from './setup-wizard-step-job-assignment';
export type { SetupWizardStepJobAssignmentProps } from './setup-wizard-step-job-assignment';

export { SetupWizardStepTestPrints } from './setup-wizard-step-test-prints';
export type { SetupWizardStepTestPrintsProps } from './setup-wizard-step-test-prints';

export { SetupWizardStepFallbackConfig } from './setup-wizard-step-fallback-config';
export type { SetupWizardStepFallbackConfigProps } from './setup-wizard-step-fallback-config';

export { SetupWizardStepSummary } from './setup-wizard-step-summary';
export type { SetupWizardStepSummaryProps } from './setup-wizard-step-summary';
