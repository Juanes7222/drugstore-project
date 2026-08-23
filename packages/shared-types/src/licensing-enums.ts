export enum LicenseStatus {
  UNACTIVATED = 'UNACTIVATED',
  ACTIVE = 'ACTIVE',
  GRACE_PERIOD = 'GRACE_PERIOD',
  LOCKED = 'LOCKED',
  REVOKED = 'REVOKED',
}

export enum PlanBillingMethod {
  // Transmission handled by our system (tech provider / our own certificate).
  PROVIDER = 'PROVIDER',
  // Customer uploads their own DIAN digital certificate in the POS.
  CERTIFICATE = 'CERTIFICATE',
}

export enum PlanFeature {
  // Location & workstation scaling
  MULTI_LOCATION = 'MULTI_LOCATION',
  UNLIMITED_LOCATIONS = 'UNLIMITED_LOCATIONS',
  MULTI_TERMINAL_SYNC = 'MULTI_TERMINAL_SYNC',

  // Core pharmacy operations
  OFFLINE_MODE = 'OFFLINE_MODE',
  INVENTORY_MANAGEMENT = 'INVENTORY_MANAGEMENT',
  PRESCRIPTION_MANAGEMENT = 'PRESCRIPTION_MANAGEMENT',
  FISCAL_PRINTING = 'FISCAL_PRINTING',
  LABEL_PRINTING = 'LABEL_PRINTING',
  CUSTOMER_DISPLAY = 'CUSTOMER_DISPLAY',

  // Reporting & analytics
  ADVANCED_REPORTS = 'ADVANCED_REPORTS',

  // Support & integrations
  PRIORITY_SUPPORT = 'PRIORITY_SUPPORT',
  API_ACCESS = 'API_ACCESS',
  CUSTOM_INTEGRATIONS = 'CUSTOM_INTEGRATIONS',

  // Branding & advanced
  WHITE_LABEL = 'WHITE_LABEL',
  BACKUP_RECOVERY = 'BACKUP_RECOVERY',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum PricingModel {
  FLAT = 'FLAT',
  PER_LOCATION = 'PER_LOCATION',
  PER_WORKSTATION = 'PER_WORKSTATION',
  TIERED = 'TIERED',
}

export enum BillingPeriod {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUAL = 'ANNUAL',
}

export enum ActivationCodeType {
  SUBSCRIPTION = 'SUBSCRIPTION',
  WORKSTATION = 'WORKSTATION',
}

export enum ActivationCodeStatus {
  UNUSED = 'UNUSED',
  USED = 'USED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum FraudSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum FraudAlertStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  DISMISSED = 'DISMISSED',
  CONFIRMED_FRAUD = 'CONFIRMED_FRAUD',
}
