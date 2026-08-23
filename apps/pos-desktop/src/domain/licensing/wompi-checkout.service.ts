/**
 * Wompi checkout client for the POS desktop.
 *
 * Calls the public licensing checkout endpoints on the NestJS server to:
 *   - List available subscription plans
 *   - Create a Wompi payment link (checkout session)
 *   - Poll the payment status until the transaction reaches a terminal state
 *
 * The POS desktop never calls Wompi directly — all payment orchestration
 * happens server-side. This client is a thin wrapper over the server's
 * `public/licensing/checkout/*` endpoints.
 *
 * Public endpoints don't require authentication, so this client does not
 * depend on AuthTokenProvider.
 */
import { API_BASE_URL } from '../../infrastructure/config';
import {
  BillingPeriod,
  WompiTransactionStatus,
} from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Request / response types (mirrors server DTOs)
// ---------------------------------------------------------------------------

export interface CheckoutPlan {
  code: string;
  name: string;
  description: string;
  pricingModel: string;
  basePriceCents: number;
  currency: string;
  billingPeriod: string;
  maxLocations: number;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
  features: string[];
  displayOrder: number;
  /**
   * Fiscal billing method: 'PROVIDER' (we handle DIAN transmission) or
   * 'CERTIFICATE' (customer uploads their own digital certificate).
   * Legacy plans without the field are treated as 'PROVIDER'.
   */
  billingMethod?: string | null;
}

export interface CreateCheckoutSessionRequest {
  planCode: string;
  customerTaxId: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  billingPeriod?: BillingPeriod;
  /**
   * Existing subscription id for renewal payments. When present the server
   * stamps the session as RENEWAL instead of NEW_SUBSCRIPTION so the payment
   * extends the subscription instead of creating a duplicate.
   */
  subscriptionId?: string;
}

export interface CheckoutSession {
  sessionId: string;
  paymentLinkId: string;
  /** Full Wompi checkout URL to redirect the user to. */
  checkoutUrl: string;
  reference: string;
  amountCents: number;
  currency: string;
}

export interface SessionStatus {
  sessionId: string;
  status: WompiTransactionStatus | string;
  statusMessage: string | null;
  wompiTransactionId: string;
  reference: string;
  /** Subscription created by an approved NEW_SUBSCRIPTION payment, if any. */
  subscriptionId: string | null;
  /**
   * First unused activation code of the new subscription. Present only when
   * the payment was APPROVED and the session purpose was NEW_SUBSCRIPTION.
   */
  activationCode: string | null;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class CheckoutError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/**
 * Thrown when a checkout session does not reach a terminal state within
 * the configured polling window. The session may still resolve later.
 */
export class CheckoutTimeoutError extends Error {
  constructor(reference: string, waitedMs: number) {
    super(`Checkout session ${reference} did not resolve within ${waitedMs}ms`);
    this.name = 'CheckoutTimeoutError';
  }
}

export interface PollOptions {
  /** Milliseconds between status polls. Defaults to 5_000. */
  intervalMs?: number;
  /** Total time to wait for a terminal state before throwing. Defaults to 5 minutes. */
  timeoutMs?: number;
  /** Invoked after each non-terminal poll so callers can refresh UI state. */
  onStatus?: (status: SessionStatus) => void;
}

/** Terminal Wompi transaction states that end the polling loop. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  WompiTransactionStatus.APPROVED,
  WompiTransactionStatus.DECLINED,
  WompiTransactionStatus.ERROR,
  WompiTransactionStatus.VOIDED,
]);

/**
 * Mirrors the server's checkout amount calculation (quarterly 10% off,
 * annual 20% off) so the UI can show period pricing before submitting.
 */
export const estimatePeriodAmountCents = (
  basePriceCents: number,
  period: BillingPeriod,
): number => {
  switch (period) {
    case BillingPeriod.QUARTERLY:
      return Math.round(basePriceCents * 3 * 0.9);
    case BillingPeriod.ANNUAL:
      return Math.round(basePriceCents * 12 * 0.8);
    case BillingPeriod.MONTHLY:
    default:
      return basePriceCents;
  }
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface WompiCheckoutService {
  /** List available public plans for subscription. */
  fetchPlans(): Promise<CheckoutPlan[]>;

  /** Create a checkout session: generates a Wompi payment link. */
  createSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession>;

  /** Poll the status of a checkout session by its wompiReference. */
  pollSession(wompiReference: string): Promise<SessionStatus>;

  /**
   * Poll a session until it reaches a terminal state (APPROVED, DECLINED,
   * ERROR or VOIDED). Throws CheckoutTimeoutError if the deadline passes.
   */
  pollUntilTerminal(wompiReference: string, options?: PollOptions): Promise<SessionStatus>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const checkoutPost = async <TReq, TRes>(path: string, body: TReq): Promise<TRes> => {
  const url = `${API_BASE_URL.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message: string;
    try {
      const err = JSON.parse(text) as { message?: string };
      message = err.message ?? text;
    } catch {
      message = text || `HTTP ${response.status}`;
    }
    throw new CheckoutError(response.status, message);
  }

  return response.json() as Promise<TRes>;
};

const checkoutGet = async <TRes>(path: string): Promise<TRes> => {
  const url = `${API_BASE_URL.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message: string;
    try {
      const err = JSON.parse(text) as { message?: string };
      message = err.message ?? text;
    } catch {
      message = text || `HTTP ${response.status}`;
    }
    throw new CheckoutError(response.status, message);
  }

  return response.json() as Promise<TRes>;
};

export const createWompiCheckoutService = (): WompiCheckoutService => ({
  fetchPlans: async (): Promise<CheckoutPlan[]> => {
    return checkoutPost<Record<string, never>, CheckoutPlan[]>(
      '/public/licensing/checkout/plans',
      {},
    );
  },

  createSession: async (request: CreateCheckoutSessionRequest): Promise<CheckoutSession> => {
    return checkoutPost<CreateCheckoutSessionRequest, CheckoutSession>(
      '/public/licensing/checkout/create-session',
      request,
    );
  },

  pollSession: async (wompiReference: string): Promise<SessionStatus> => {
    return checkoutGet<SessionStatus>(
      `/public/licensing/checkout/session/${wompiReference}`,
    );
  },

  pollUntilTerminal: async (
    wompiReference: string,
    options: PollOptions = {},
  ): Promise<SessionStatus> => {
    const intervalMs = options.intervalMs ?? 5_000;
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      // Transient network errors keep the loop alive; the deadline is the
      // ultimate guard so a dead connection surfaces as CheckoutTimeoutError.
      try {
        const status = await checkoutGet<SessionStatus>(
          `/public/licensing/checkout/session/${wompiReference}`,
        );

        if (TERMINAL_STATUSES.has(status.status)) return status;

        options.onStatus?.(status);
      } catch (error) {
        if (error instanceof CheckoutError) {
          options.onStatus?.({
            sessionId: '',
            status: WompiTransactionStatus.PENDING,
            statusMessage: null,
            wompiTransactionId: '',
            reference: wompiReference,
            subscriptionId: null,
            activationCode: null,
          });
        } else {
          throw error;
        }
      }

      if (Date.now() + intervalMs > deadline) {
        throw new CheckoutTimeoutError(wompiReference, timeoutMs);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  },
});
