import { Injectable, Logger } from '@nestjs/common';
import { WompiConfigService } from './wompi-config.service';
import {
  getWompiBaseUrl,
  WOMpi_CHECKOUT_BASE_URL,
  type WompiWebhookEvent,
  type WompiTransactionUpdatedData,
  type WompiTransaction,
  type WompiCreateTransactionRequest,
  type WompiPaymentLink,
  type WompiCreatePaymentLinkRequest,
  type WompiAcceptanceTokenResponse,
  type WompiResponse,
} from '@pharmacy/shared-types';
import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';

const WOMPI_TRANSACTION_ERROR = 'WOMPI_TRANSACTION_ERROR';
const WOMPI_PAYMENT_LINK_ERROR = 'WOMPI_PAYMENT_LINK_ERROR';
const WOMPI_ACCEPTANCE_TOKEN_ERROR = 'WOMPI_ACCEPTANCE_TOKEN_ERROR';
const WOMPI_API_ERROR = 'WOMPI_API_ERROR';

interface WompiErrorBody {
  error?: {
    type?: string;
    reason?: string;
    messages?: Record<string, string[]>;
  };
}

/**
 * Low-level HTTP client for the Wompi Colombia API.
 *
 * All methods call the Wompi REST API using native fetch (Node 22).
 * Error responses are parsed and thrown as DomainException.
 *
 * Configuration is resolved lazily so the server starts even when Wompi
 * keys are absent (isConfigured returns false). Each public method checks
 * configuration before making API calls.
 */
@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);

  constructor(private readonly wompiConfig: WompiConfigService) {}

  /** Whether Wompi API keys are present. */
  private get config() {
    return this.wompiConfig.getConfig();
  }

  /** Base URL derived from the configured environment. */
  private get baseUrl(): string {
    return getWompiBaseUrl(this.config.environment);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** POST /v1/transactions — create a payment transaction. */
  async createTransaction(request: WompiCreateTransactionRequest): Promise<WompiTransaction> {
    return this.post<WompiTransaction>(
      `${this.baseUrl}/transactions`,
      request,
      this.privateAuthHeaders(),
    );
  }

  /** GET /v1/transactions/:id — fetch transaction status. */
  async getTransaction(transactionId: string): Promise<WompiTransaction> {
    return this.get<WompiTransaction>(
      `${this.baseUrl}/transactions/${transactionId}`,
      { Authorization: `Bearer ${this.config.publicKey}` },
    );
  }

  /** POST /v1/payment_links — create a payment link. */
  async createPaymentLink(request: WompiCreatePaymentLinkRequest): Promise<WompiPaymentLink> {
    return this.post<WompiPaymentLink>(
      `${this.baseUrl}/payment_links`,
      request,
      this.privateAuthHeaders(),
    );
  }

  /** GET /v1/payment_links/:id — fetch payment link (no auth needed). */
  async getPaymentLink(linkId: string): Promise<WompiPaymentLink> {
    return this.get<WompiPaymentLink>(`${this.baseUrl}/payment_links/${linkId}`);
  }

  /** GET /v1/merchants/:publicKey — fetch the acceptance token. */
  async getAcceptanceToken(): Promise<string> {
    const response = await this.get<WompiAcceptanceTokenResponse>(
      `${this.baseUrl}/merchants/${this.config.publicKey}`,
    );
    return response.data.presigned_acceptance.acceptance_token;
  }

  /**
   * Generate the transaction integrity signature.
   * SHA-256 of: reference + amountInCents + currency + privateKey
   */
  generateSignature(reference: string, amountInCents: number, currency: string): string {
    const payload = `${reference}${amountInCents}${currency}${this.config.privateKey}`;
    return createHash('sha256').update(payload, 'utf-8').digest('hex');
  }

  /**
   * Verify a Wompi webhook signature.
   * Algorithm per https://docs.wompi.co/docs/colombia/eventos/:
   *   1. Extract signature.properties[] from event
   *   2. Get values from event.data using the property paths
   *   3. Concatenate propertyValues + event.timestamp + eventsSecret
   *   4. SHA-256, compare uppercase with signature.checksum
   */
  verifyWebhookSignature(event: WompiWebhookEvent<WompiTransactionUpdatedData>): boolean {
    const { signature, data, timestamp } = event;

    if (!signature || !signature.properties || !signature.checksum) {
      this.logger.warn('Webhook event missing signature fields');
      return false;
    }

    const eventsSecret = this.config.eventsSecret;

    // Get values from event.data using property paths (e.g. "transaction.id")
    const propertyValues = signature.properties
      .map((propPath: string) => {
        const value = this.resolveNestedProperty(data, propPath);
        // Wompi serializes numbers and booleans for concatenation
        if (typeof value === 'number' || typeof value === 'boolean') {
          return String(value);
        }
        return value ?? '';
      })
      .join('');

    const concatenated = `${propertyValues}${timestamp}${eventsSecret}`;
    const computedChecksum = createHash('sha256')
      .update(concatenated, 'utf-8')
      .digest('hex')
      .toUpperCase();

    const isValid = computedChecksum === signature.checksum;

    if (!isValid) {
      this.logger.warn(
        `Webhook signature mismatch: expected=${signature.checksum}, computed=${computedChecksum}`,
      );
    }

    return isValid;
  }

  /** Build the checkout URL from a payment link id. */
  buildCheckoutUrl(linkId: string): string {
    return `${WOMpi_CHECKOUT_BASE_URL}${linkId}`;
  }

  // -----------------------------------------------------------------------
  // Private HTTP helpers
  // -----------------------------------------------------------------------

  private privateAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.privateKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
    });

    return this.handleResponse<T>(response, url);
  }

  private async post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response, url);
  }

  private async handleResponse<T>(response: globalThis.Response, url: string): Promise<T> {
    const rawBody = await response.text().catch(() => '');

    if (!response.ok) {
      let wompiError = { type: 'UNKNOWN', reason: `HTTP ${response.status}` };
      try {
        const parsed = JSON.parse(rawBody) as WompiErrorBody;
        if (parsed.error) {
          wompiError = {
            type: parsed.error.type ?? 'UNKNOWN',
            reason: parsed.error.reason ?? JSON.stringify(parsed.error.messages ?? {}),
          };
        }
      } catch {
        // rawBody is not JSON
      }

      const errorCode = url.includes('/transactions')
        ? WOMPI_TRANSACTION_ERROR
        : url.includes('/payment_links')
          ? WOMPI_PAYMENT_LINK_ERROR
          : url.includes('/merchants')
            ? WOMPI_ACCEPTANCE_TOKEN_ERROR
            : WOMPI_API_ERROR;

      this.logger.error(`Wompi API error [${errorCode}]: ${wompiError.type} — ${wompiError.reason}`);

      throw new DomainException(
        errorCode,
        `Wompi API error: ${wompiError.reason}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    try {
      const parsed = JSON.parse(rawBody) as WompiResponse<T>;
      return parsed.data;
    } catch {
      throw new DomainException(
        WOMPI_API_ERROR,
        'Failed to parse Wompi API response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Resolve a dot-separated property path against a nested object.
   * Example: resolveNestedProperty({ transaction: { id: '123' } }, 'transaction.id') → '123'
   */
  private resolveNestedProperty(
    obj: unknown,
    path: string,
  ): string | number | boolean | null {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return null;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === null || current === undefined) {
      return null;
    }
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
      return current;
    }
    return String(current);
  }
}
