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
}

interface LicenseActions {
  setActivated: (data: {
    activationToken: string;
    expiresAt: string;
    subscription: { id: string; status: string; currentPeriodEnd: string; gracePeriodDays: number };
    location: { id: string; name: string; address?: string | null; city?: string | null; region?: string | null } | null;
    plan: { id: string; code: string; name: string; features: string[]; maxLocations: number; maxWorkstationsPerLocation: number };
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
};

export const useLicenseStore = create<LicenseStore>()(
  persist(
    (set) => ({
      ...initialState,

      setActivated: (data) => set({
        status: LicenseStatus.ACTIVE,
        activationToken: data.activationToken,
        tokenExpiresAt: data.expiresAt,
        subscriptionId: data.subscription.id,
        subscriptionStatus: data.subscription.status,
        planId: data.plan.id,
        planCode: data.plan.code,
        planName: data.plan.name,
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
      }),
    },
  ),
);
