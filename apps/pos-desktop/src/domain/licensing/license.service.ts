/**
 * License service for the POS desktop app.
 *
 * Manages the lifecycle of the workstation license: activation, check-in,
 * local token validation, and license status computation.
 *
 * The activation requires connectivity (POST to server). After activation,
 * the license token is cached locally and can be validated offline.
 * Periodic check-ins refresh the token and update the subscription status.
 */
import { LicenseStatus, type ActivationResult, type CheckInResult, type LicenseSummary } from '@pharmacy/shared-types';
import { useLicenseStore } from './license.store';
import {
  ActivationFailedException,
  AlreadyActivatedException,
  LicenseInvalidException,
} from './exceptions';

export interface LicenseServiceConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
}

export interface LicenseGuard {
  /**
   * Ensures the license is in a valid state for write operations.
   * Throws LicenseInvalidException if the status is LOCKED or REVOKED.
   * Grace period allows operations through.
   */
  requireValidLicense(): void;

  /**
   * Returns the current computed license status.
   */
  getStatus(): LicenseStatus;
}

export interface LicenseService extends LicenseGuard {
  /**
   * Activate this workstation with an activation code.
   * Requires connectivity.
   */
  activate(code: string, workstationName: string, locationData?: {
    name?: string;
    address?: string;
    city?: string;
    region?: string;
  }): Promise<ActivationResult>;

  /**
   * Perform a periodic check-in with the server.
   * Silently fails on network errors (local token continues to work).
   */
  checkIn(): Promise<CheckInResult | null>;

  /**
   * Validate the locally stored token without server contact.
   * Returns true if the token exists and hasn't expired.
   */
  validateTokenLocally(): boolean;

  /**
   * Get a summary of the license status for display.
   */
  getSummary(): LicenseSummary;

  /**
   * Force refresh the license status from the server.
   */
  refreshStatus(): Promise<void>;
}

/**
 * Simple base64-encoded JSON token decoder.
 * Does NOT verify the signature (that requires the server's secret).
 * For local validation, we check expiration only.
 */
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if a token is expired by examining its exp claim (epoch seconds).
 */
function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload || !payload.exp) return true;
  const exp = payload.exp as number;
  const now = Math.floor(Date.now() / 1000);
  return now >= exp;
}

const defaultHttpClient = {
  post: async <TReq, TRes>(url: string, body: TReq): Promise<TRes> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText) as { message?: string };
        errorMessage = errorJson.message ?? errorText;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }
      throw new ActivationFailedException(errorMessage);
    }
    return response.json() as Promise<TRes>;
  },
};

export const createLicenseService = (config: LicenseServiceConfig): LicenseService => {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const http = defaultHttpClient;

  return {
    // -----------------------------------------------------------------------
    // LicenseGuard implementation
    // -----------------------------------------------------------------------

    requireValidLicense: (): void => {
      const state = useLicenseStore.getState();
      if (state.status === LicenseStatus.LOCKED || state.status === LicenseStatus.REVOKED) {
        throw new LicenseInvalidException();
      }
    },

    getStatus: (): LicenseStatus => {
      const state = useLicenseStore.getState();
      if (state.status === LicenseStatus.UNACTIVATED) return LicenseStatus.UNACTIVATED;

      // If we have a token but it's expired, check subscription status
      if (state.activationToken && isTokenExpired(state.activationToken)) {
        if (state.subscriptionStatus === 'PAST_DUE' && state.daysUntilGracePeriodEnd && state.daysUntilGracePeriodEnd > 0) {
          return LicenseStatus.GRACE_PERIOD;
        }
        return LicenseStatus.LOCKED;
      }

      if (state.subscriptionStatus === 'PAST_DUE' && state.daysUntilGracePeriodEnd && state.daysUntilGracePeriodEnd > 0) {
        return LicenseStatus.GRACE_PERIOD;
      }

      if (state.subscriptionStatus === 'REVOKED') {
        return LicenseStatus.REVOKED;
      }

      return state.status;
    },

    // -----------------------------------------------------------------------
    // Activation
    // -----------------------------------------------------------------------

    activate: async (code, workstationName, locationData?): Promise<ActivationResult> => {
      const currentStatus = useLicenseStore.getState().status;
      if (currentStatus !== LicenseStatus.UNACTIVATED && currentStatus !== LicenseStatus.REVOKED) {
        throw new AlreadyActivatedException();
      }

      // Get hardware fingerprint from Tauri
      let hardwareFingerprint: string;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        hardwareFingerprint = await invoke<string>('get_hardware_fingerprint');
      } catch {
        // Fallback for development outside Tauri
        hardwareFingerprint = `dev-fingerprint-${crypto.randomUUID()}`;
      }

      const result = await http.post<Record<string, unknown>, ActivationResult>(
        `${baseUrl}/public/licensing/activate`,
        {
          code,
          hardwareFingerprint,
          workstationName,
          locationName: locationData?.name,
          locationAddress: locationData?.address,
          locationCity: locationData?.city,
          locationRegion: locationData?.region,
        },
      );

      // Persist to store
      useLicenseStore.getState().setActivated({
        ...result,
        hardwareFingerprint,
      });

      return result;
    },

    // -----------------------------------------------------------------------
    // Check-in
    // -----------------------------------------------------------------------

    checkIn: async (): Promise<CheckInResult | null> => {
      const state = useLicenseStore.getState();
      if (!state.activationToken) return null;

      let hardwareFingerprint: string;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        hardwareFingerprint = await invoke<string>('get_hardware_fingerprint');
      } catch {
        hardwareFingerprint = state.hardwareFingerprint ?? 'unknown';
      }

      try {
        const result = await http.post<Record<string, unknown>, CheckInResult>(
          `${baseUrl}/public/licensing/check-in`,
          {
            activationToken: state.activationToken,
            hardwareFingerprint,
          },
        );

        // Update store with check-in result
        useLicenseStore.getState().setCheckInResult(result);
        return result;
      } catch {
        // Silent failure — local token continues to work
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Token validation
    // -----------------------------------------------------------------------

    validateTokenLocally: (): boolean => {
      const state = useLicenseStore.getState();
      if (!state.activationToken) return false;

      try {
        return !isTokenExpired(state.activationToken);
      } catch {
        return false;
      }
    },

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------

    getSummary: (): LicenseSummary => {
      const state = useLicenseStore.getState();
      return {
        status: state.status,
        daysUntilExpiry: state.daysUntilExpiry,
        daysUntilGracePeriodEnd: state.daysUntilGracePeriodEnd,
        lastCheckInAt: state.lastCheckInAt,
        checkInsLast30Days: state.checkInsLast30Days,
      };
    },

    // -----------------------------------------------------------------------
    // Refresh
    // -----------------------------------------------------------------------

    refreshStatus: async (): Promise<void> => {
      // checkIn is called via the service reference
      const svc = createLicenseService(config);
      await svc.checkIn();
    },
  } as LicenseService;
};
