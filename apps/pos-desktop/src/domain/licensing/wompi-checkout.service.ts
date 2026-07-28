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
  type WompiTransactionStatus,
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
}

export interface CreateCheckoutSessionRequest {
  planCode: string;
  customerTaxId: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  billingPeriod?: BillingPeriod;
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
});
