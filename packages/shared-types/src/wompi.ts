// ---------------------------------------------------------------------------
// Wompi Colombia payment gateway types
//
// Models the Wompi API surface for transactions, payment links, and webhook
// events. Used by both apps/server (to initiate payments and handle
// callbacks) and apps/pos-desktop (to display payment status).
//
// API reference: https://docs.wompi.co/docs/colombia/referencia/
// ---------------------------------------------------------------------------

/**
 * Final states for a Wompi transaction.
 * A newly created transaction is always PENDING; the integration must poll
 * or wait for a webhook to discover the terminal state.
 */
export enum WompiTransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED',
  ERROR = 'ERROR',
}

/**
 * Wompi payment method types for transaction creation.
 */
export enum WompiPaymentMethodType {
  CARD = 'CARD',
  NEQUI = 'NEQUI',
  PSE = 'PSE',
  BANCOLOMBIA_TRANSFER = 'BANCOLOMBIA_TRANSFER',
  BANCOLOMBIA_QR = 'BANCOLOMBIA_QR',
  BANCOLOMBIA_COLLECT = 'BANCOLOMBIA_COLLECT',
  BANCOLOMBIA_BNPL = 'BANCOLOMBIA_BNPL',
  DAVIPLATA = 'DAVIPLATA',
  PCOL = 'PCOL',
}

/**
 * Card brands returned by Wompi tokenization.
 */
export type WompiCardBrand = 'VISA' | 'MASTERCARD' | 'AMEX' | 'DINERS';

/**
 * Currency code. Wompi Colombia only supports COP.
 */
export type WompiCurrency = 'COP';

// ---------------------------------------------------------------------------
// Transaction creation
// ---------------------------------------------------------------------------

/** Payment method payload for CARD transactions. */
export interface WompiCardPaymentMethod {
  type: 'CARD';
  /** Tokenized card (from POST /v1/tokens/cards). */
  token: string;
  /** Number of installments (1-36). */
  installments: number;
}

/** Payment method payload for NEQUI transactions. */
export interface WompiNequiPaymentMethod {
  type: 'NEQUI';
  phone_number: string;
}

/** Payment method payload for PSE transactions. */
export interface WompiPsePaymentMethod {
  type: 'PSE';
  user_type: 0 | 1;
  user_legal_id_type: 'CC' | 'NIT' | 'CE' | 'TI' | 'PPN';
  user_legal_id: string;
  financial_institution_code: string;
  payment_description: string;
  /** IP del cliente (requerido para Servicios Financieros). */
  reference_one?: string;
  /** Fecha de apertura del producto en formato yyyymmdd. */
  reference_two?: string;
  /** Número de documento del beneficiario del producto financiero. */
  reference_three?: string;
}

/** Payment method payload for Bancolombia transfer. */
export interface WompiBancolombiaTransferPaymentMethod {
  type: 'BANCOLOMBIA_TRANSFER';
  payment_description: string;
  ecommerce_url?: string;
}

/** Payment method payload for Bancolombia QR. */
export interface WompiBancolombiaQrPaymentMethod {
  type: 'BANCOLOMBIA_QR';
  payment_description: string;
  /** Solo para sandbox: status final deseado. */
  sandbox_status?: 'APPROVED' | 'DECLINED' | 'ERROR';
}

/** Payment method payload for Corresponsales Bancarios. */
export interface WompiBancolombiaCollectPaymentMethod {
  type: 'BANCOLOMBIA_COLLECT';
}

/** Union of all Wompi payment method payloads. */
export type WompiPaymentMethod =
  | WompiCardPaymentMethod
  | WompiNequiPaymentMethod
  | WompiPsePaymentMethod
  | WompiBancolombiaTransferPaymentMethod
  | WompiBancolombiaQrPaymentMethod
  | WompiBancolombiaCollectPaymentMethod;

/** Request body for POST /v1/transactions. */
export interface WompiCreateTransactionRequest {
  acceptance_token: string;
  amount_in_cents: number;
  currency: WompiCurrency;
  customer_email: string;
  payment_method: WompiPaymentMethod;
  reference: string;
  signature: string;
  payment_method_type?: string;
  redirect_url?: string;
  ip?: string;
  customer_data?: {
    phone_number?: string;
    full_name?: string;
  };
}

/** Transaction object returned by the Wompi API. */
export interface WompiTransaction {
  id: string;
  reference: string;
  created_at: string;
  finalized_at: string | null;
  amount_in_cents: number;
  currency: WompiCurrency;
  customer_email: string;
  payment_method_type: string;
  payment_method: {
    type: string;
    extra?: Record<string, unknown>;
    [key: string]: unknown;
  };
  redirect_url: string | null;
  status: WompiTransactionStatus;
  status_message: string | null;
  merchant: {
    id: string;
    name: string;
    legal_name: string;
    contact_name: string;
    phone_number: string;
    logo_url: string | null;
    legal_id_type: string;
    email: string;
    legal_id: string;
    public_key: string;
  };
  taxes: Array<{
    type: string;
    amount_in_cents: number;
  }>;
  tip_in_cents: number | null;
  payment_link_id: string | null;
  payment_source_id: string | null;
}

/** Wompi API envelope for a single result. */
export interface WompiResponse<T> {
  data: T;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Payment links (links de pago)
// ---------------------------------------------------------------------------

/** Request body for POST /v1/payment_links. */
export interface WompiCreatePaymentLinkRequest {
  name: string;
  description: string;
  single_use: boolean;
  collect_shipping: boolean;
  currency?: WompiCurrency;
  amount_in_cents?: number | null;
  expires_at?: string;
  redirect_url?: string | null;
  image_url?: string | null;
  sku?: string | null;
  customer_data?: {
    customer_references?: Array<{
      label: string;
      is_required: boolean;
    }>;
  };
  taxes?: Array<{
    type: 'VAT' | 'CONSUMPTION';
    amount_in_cents?: number;
    percentage?: number;
  }>;
}

/** Payment link object returned by the Wompi API. */
export interface WompiPaymentLink {
  id: string;
  name: string;
  description: string;
  single_use: boolean;
  collect_shipping: boolean;
  currency: WompiCurrency;
  amount_in_cents: number | null;
  sku: string | null;
  expires_at: string | null;
  redirect_url: string | null;
  image_url: string | null;
  active: boolean;
  customer_data: {
    customer_references?: Array<{
      label: string;
      is_required: boolean;
    }>;
  } | null;
  created_at: string;
  updated_at: string;
  merchant_public_key: string;
}

/** Computed checkout URL for a payment link. */
export const WOMpi_CHECKOUT_BASE_URL = 'https://checkout.wompi.co/l/';

// ---------------------------------------------------------------------------
// Acceptance tokens
// ---------------------------------------------------------------------------

/** Response from GET /v1/merchants/:publicKey (acceptance token). */
export interface WompiAcceptanceTokenResponse {
  data: {
    /** JWT acceptance token. */
    presigned_acceptance: {
      acceptance_token: string;
      type: string;
      permalink: string;
    };
    /** Raw HTML of the acceptance terms. */
    presigned_personal_data_auth: {
      acceptance_token: string;
      type: string;
      permalink: string;
    };
  };
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

/** Known Wompi event types. */
export enum WompiEventType {
  TRANSACTION_UPDATED = 'transaction.updated',
  NEQUI_TOKEN_UPDATED = 'nequi_token.updated',
  BANCOLOMBIA_TRANSFER_TOKEN_UPDATED = 'bancolombia_transfer_token.updated',
}

/** Signature block inside a webhook event. */
export interface WompiEventSignature {
  properties: string[];
  checksum: string;
}

/** Webhook event payload sent by Wompi to the merchant's events URL. */
export interface WompiWebhookEvent<TData = unknown> {
  event: WompiEventType | string;
  data: TData;
  environment: 'test' | 'prod';
  signature: WompiEventSignature;
  timestamp: number;
  sent_at: string;
}

/** Data payload for the transaction.updated event. */
export interface WompiTransactionUpdatedData {
  transaction: WompiTransaction;
}

// ---------------------------------------------------------------------------
// Subscription-specific payment types
// ---------------------------------------------------------------------------

/**
 * Purpose of a subscription payment.
 * Determines what happens after payment confirmation.
 */
export enum SubscriptionPaymentPurpose {
  /** Initial activation payment for a new subscription. */
  NEW_SUBSCRIPTION = 'NEW_SUBSCRIPTION',
  /** Renewal payment for an existing subscription. */
  RENEWAL = 'RENEWAL',
  /** Plan upgrade payment (difference in price). */
  PLAN_UPGRADE = 'PLAN_UPGRADE',
  /** Extra workstation purchase. */
  EXTRA_WORKSTATION = 'EXTRA_WORKSTATION',
}

/**
 * Links a pending Wompi transaction to a subscription payment.
 * Stored server-side until the webhook confirms the payment.
 */
export interface SubscriptionPendingPayment {
  id: string;
  subscriptionId: string | null; // null for new subscriptions (pre-creation)
  wompiTransactionId: string;
  wompiReference: string;
  purpose: SubscriptionPaymentPurpose;
  planId: string;
  amountCents: number;
  currency: string;
  customerTaxId: string;
  customerEmail: string;
  customerName: string;
  /** For new subscriptions: data needed to create the subscription on payment confirmation. */
  newSubscriptionData?: CreateSubscriptionFromCheckout;
  createdAt: string;
  expiresAt: string;
}

/** Data needed to create a subscription after a successful checkout payment. */
export interface CreateSubscriptionFromCheckout {
  customerName: string;
  customerTaxId: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  paymentMethod: string;
  gracePeriodDays?: number;
  trialEndsAt?: string | null;
}

// ---------------------------------------------------------------------------
// Environment configuration for Wompi
// ---------------------------------------------------------------------------

/** Wompi API base URLs. */
export const WOMpi_API_URLS = {
  production: 'https://production.wompi.co/v1',
  sandbox: 'https://sandbox.wompi.co/v1',
} as const;

/** Wompi keyset required for integration. */
export interface WompiConfig {
  /** Public key (pub_test_* or pub_prod_*). Safe for client-side use. */
  publicKey: string;
  /** Private key (prv_test_* or prv_prod_*). Server-side only. */
  privateKey: string;
  /** Events secret for webhook signature verification. Server-side only. */
  eventsSecret: string;
  /** Environment: 'test' (sandbox) or 'prod' (production). */
  environment: 'test' | 'prod';
}

/**
 * Computes the Wompi API base URL from the environment.
 */
export const getWompiBaseUrl = (environment: 'test' | 'prod'): string =>
  environment === 'prod' ? WOMpi_API_URLS.production : WOMpi_API_URLS.sandbox;
