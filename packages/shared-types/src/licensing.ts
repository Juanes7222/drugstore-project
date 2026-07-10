export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  billingPeriod: string;
  maxLocations: number;
  maxWorkstationsPerLocation: number;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
  features: string[];
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
}

export interface Subscription {
  id: string;
  planId: string;
  plan?: Plan;
  customerName: string;
  customerTaxId: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  lastPaymentAt: string | null;
  nextPaymentDueAt: string | null;
  gracePeriodDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  subscriptionId: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface WorkstationActivation {
  id: string;
  subscriptionId: string;
  locationId: string;
  hardwareFingerprint: string;
  workstationName: string;
  activationCodeId: string | null;
  isActive: boolean;
  activatedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastCheckInAt: string | null;
  checkInCount: number;
}

export interface ActivationCode {
  id: string;
  subscriptionId: string;
  locationId: string | null;
  code: string;
  type: string;
  status: string;
  usedAt: string | null;
  expiresAt: string;
}

export interface FraudAlert {
  id: string;
  subscriptionId: string;
  workstationActivationId: string | null;
  severity: string;
  suggestedAction: string;
  status: string;
  detectorName: string;
  reason: string;
  details: unknown | null;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface ActivationResult {
  activationToken: string;
  expiresAt: string;
  subscription: Subscription;
  location: Location;
  plan: Plan;
  workstationActivation: WorkstationActivation;
}

export interface CheckInResult {
  activationToken: string;
  expiresAt: string;
  licenseStatus: string;
  subscription: Subscription;
  daysUntilGracePeriodEnd: number | null;
}

export interface LicenseSummary {
  status: string;
  daysUntilExpiry: number | null;
  daysUntilGracePeriodEnd: number | null;
  lastCheckInAt: string | null;
  checkInsLast30Days: number;
}
