/**
 * Zustand store for the license state of this POS workstation.
 *
 * Persisted to localStorage so that the activation token survives app restarts.
 * The store is the single source of truth for license status on the POS.
 *
 * On fresh install (no persisted data), the status is UNACTIVATED and the
 * activation page is shown.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LicenseStatus } from '@pharmacy/shared-types';

/**
 * Shape of the persisted license state.
 */
export interface LicenseState {
  status: LicenseStatus;
  activationToken: string | null;
  tokenExpiresAt: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  /**
   * Fiscal billing method of the subscription plan: 'PROVIDER' (we handle
   * DIAN transmission) or 'CERTIFICATE' (the customer uploads their own
   * digital certificate). Legacy plans default to 'PROVIDER'.
   */
  billingMethod: string | null;
  planFeatures: string[];
  maxLocations: number | null;
  maxWorkstationsPerLocation: number | null;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  workstationId: string | null;
  workstationName: string | null;
  hardwareFingerprint: string | null;
  activatedAt: string | null;
  lastCheckInAt: string | null;
  nextCheckInDue: string | null;
  daysUntilGracePeriodEnd: number | null;
  daysUntilExpiry: number | null;
  checkInsLast30Days: number;

  /** Whether a renewal payment flow is currently in progress. */
  isRenewalInProgress: boolean;
  /** Wompi checkout URL for the active renewal (not persisted). */
  renewalCheckoutUrl: string | null;
  /** Reference for polling the renewal payment status. */
  renewalReference: string | null;
  /** ISO timestamp of the last renewal attempt. */
  lastRenewalAttempt: string | null;

  /**
   * Activation code obtained from an approved self-service checkout.
   * Persisted so the code survives a restart before the workstation is
   * activated. Cleared once the code is consumed or explicitly dismissed.
   */
  pendingActivationCode: string | null;
}

interface LicenseActions {
  /**
   * Store an activation code received after a successful checkout payment.
   */
  setPendingActivationCode: (code: string) => void;

  /** Clear the pending activation code (consumed, or dismissed by the user). */
  clearPendingActivationCode: () => void;

  setActivated: (data: {
    activationToken: string;
    expiresAt: string;
    subscription: { id: string; status: string; currentPeriodEnd: string; gracePeriodDays: number };
    location: { id: string; name: string; address?: string | null; city?: string | null; region?: string | null } | null;
    plan: { id: string; code: string; name: string; billingMethod?: string | null; features: string[]; maxLocations: number; maxWorkstationsPerLocation: number };
    workstationActivation: { id: string; workstationName: string; activatedAt: string };
    hardwareFingerprint: string;
  }) => void;

  setCheckInResult: (data: {
    activationToken: string | null;
    expiresAt: string;
    licenseStatus: string;
    subscription: { id: string; status: string; currentPeriodEnd: string; gracePeriodDays: number };
    daysUntilGracePeriodEnd: number | null;
  }) => void;

  setGracePeriod: (daysUntilEnd: number) => void;

  setLocked: () => void;

  setRevoked: () => void;

  setCheckInTimestamp: () => void;

  updateCheckInCount: (count: number) => void;

  /** Start a subscription renewal payment flow. */
  startRenewal: (reference: string, checkoutUrl: string) => void;

  /** Mark the renewal as completed successfully. */
  completeRenewal: () => void;

  /** Cancel an in-progress renewal. */
  cancelRenewal: () => void;

  reset: () => void;
}

type LicenseStore = LicenseState & LicenseActions;

const initialState: LicenseState = {
  status: LicenseStatus.UNACTIVATED,
  activationToken: null,
  tokenExpiresAt: null,
  subscriptionId: null,
  subscriptionStatus: null,
  planId: null,
  planCode: null,
  planName: null,
  billingMethod: null,
  planFeatures: [],
  maxLocations: null,
  maxWorkstationsPerLocation: null,
  locationId: null,
  locationName: null,
  locationAddress: null,
  locationCity: null,
  locationRegion: null,
  workstationId: null,
  workstationName: null,
  hardwareFingerprint: null,
  activatedAt: null,
  lastCheckInAt: null,
  nextCheckInDue: null,
  daysUntilGracePeriodEnd: null,
  daysUntilExpiry: null,
  checkInsLast30Days: 0,

  isRenewalInProgress: false,
  renewalCheckoutUrl: null,
  renewalReference: null,
  lastRenewalAttempt: null,
  pendingActivationCode: null,
};

export const useLicenseStore = create<LicenseStore>()(
  persist(
    (set) => ({
      ...initialState,

      setPendingActivationCode: (code) => set({
        pendingActivationCode: code,
      }),

      clearPendingActivationCode: () => set({
        pendingActivationCode: null,
      }),

      setActivated: (data) => set({
        status: LicenseStatus.ACTIVE,
        activationToken: data.activationToken,
        tokenExpiresAt: data.expiresAt,
        subscriptionId: data.subscription.id,
        subscriptionStatus: data.subscription.status,
        planId: data.plan.id,
        planCode: data.plan.code,
        planName: data.plan.name,
        billingMethod: data.plan.billingMethod ?? 'PROVIDER',
        planFeatures: data.plan.features,
        maxLocations: data.plan.maxLocations,
        maxWorkstationsPerLocation: data.plan.maxWorkstationsPerLocation,
        locationId: data.location?.id ?? null,
        locationName: data.location?.name ?? null,
        locationAddress: data.location?.address ?? null,
        locationCity: data.location?.city ?? null,
        locationRegion: data.location?.region ?? null,
        workstationId: data.workstationActivation.id,
        workstationName: data.workstationActivation.workstationName,
        hardwareFingerprint: data.hardwareFingerprint,
        activatedAt: data.workstationActivation.activatedAt,
        lastCheckInAt: new Date().toISOString(),
        daysUntilExpiry: Math.ceil(
          (new Date(data.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      }),

      setCheckInResult: (data) => set((state) => ({
        activationToken: data.activationToken ?? state.activationToken,
        tokenExpiresAt: data.expiresAt,
        subscriptionStatus: data.subscription.status,
        status: data.licenseStatus as LicenseStatus,
        lastCheckInAt: new Date().toISOString(),
        daysUntilGracePeriodEnd: data.daysUntilGracePeriodEnd,
        daysUntilExpiry: data.activationToken
          ? Math.ceil(
              (new Date(data.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            )
          : state.daysUntilExpiry,
        checkInsLast30Days: state.checkInsLast30Days + 1,
      })),

      setGracePeriod: (daysUntilEnd) => set({
        status: LicenseStatus.GRACE_PERIOD,
        daysUntilGracePeriodEnd: daysUntilEnd,
      }),

      setLocked: () => set({
        status: LicenseStatus.LOCKED,
        daysUntilGracePeriodEnd: 0,
        daysUntilExpiry: 0,
      }),

      setRevoked: () => set({
        status: LicenseStatus.REVOKED,
        activationToken: null,
        tokenExpiresAt: null,
      }),

      setCheckInTimestamp: () => set({
        lastCheckInAt: new Date().toISOString(),
      }),

      updateCheckInCount: (count) => set({
        checkInsLast30Days: count,
      }),

      startRenewal: (reference, checkoutUrl) => set({
        isRenewalInProgress: true,
        renewalCheckoutUrl: checkoutUrl,
        renewalReference: reference,
        lastRenewalAttempt: new Date().toISOString(),
      }),

      completeRenewal: () => set({
        isRenewalInProgress: false,
        renewalCheckoutUrl: null,
        renewalReference: null,
      }),

      cancelRenewal: () => set({
        isRenewalInProgress: false,
        renewalCheckoutUrl: null,
        renewalReference: null,
      }),

      reset: () => set(initialState),
    }),
    {
      name: 'pharmacy-license-store',
      partialize: (state) => ({
        status: state.status,
        activationToken: state.activationToken,
        tokenExpiresAt: state.tokenExpiresAt,
        subscriptionId: state.subscriptionId,
        subscriptionStatus: state.subscriptionStatus,
        planId: state.planId,
        planCode: state.planCode,
        planName: state.planName,
        billingMethod: state.billingMethod,
        planFeatures: state.planFeatures,
        maxLocations: state.maxLocations,
        maxWorkstationsPerLocation: state.maxWorkstationsPerLocation,
        locationId: state.locationId,
        locationName: state.locationName,
        locationAddress: state.locationAddress,
        locationCity: state.locationCity,
        locationRegion: state.locationRegion,
        workstationId: state.workstationId,
        workstationName: state.workstationName,
        hardwareFingerprint: state.hardwareFingerprint,
        activatedAt: state.activatedAt,
        lastCheckInAt: state.lastCheckInAt,
        daysUntilGracePeriodEnd: state.daysUntilGracePeriodEnd,
        daysUntilExpiry: state.daysUntilExpiry,
        checkInsLast30Days: state.checkInsLast30Days,
        pendingActivationCode: state.pendingActivationCode,
      }),
    },
  ),
);
