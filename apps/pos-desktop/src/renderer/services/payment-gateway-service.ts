/**
 * Payment gateway service interface.
 *
 * This is the narrow boundary between the PaymentProcessing UI and whatever
 * confirms electronic payments in the future (card terminal, PSP transfer API,
 * Nequi QR integration, etc.). The component and the Redux slice depend only
 * on this interface; swapping the mock for a real implementation is a single
 * factory change.
 */
import { ElectronicPaymentMethodType } from "@/store/slices/payment-types";

export interface PaymentAuthorizationRequest {
  /** Electronic method being authorized. */
  methodType: ElectronicPaymentMethodType;
  /** Amount to authorize, in Colombian-peso cents. */
  amountCents: number;
  /** Optional merchant invoice or transaction reference. */
  reference?: string;
}

export interface PaymentAuthorizationResult {
  /** Outcome of the authorization attempt. */
  status: "approved" | "rejected";
  /** Gateway/terminal reference when approved. */
  reference?: string;
  /** Human-readable reason when rejected. */
  rejectionReason?: string;
}

export interface PaymentGatewayService {
  /**
   * Request authorization for an electronic payment method.
   *
   * The promise resolves when the terminal/gateway responds. Callers must
   * update the payment slice with the returned status.
   */
  authorize(
    request: PaymentAuthorizationRequest,
  ): Promise<PaymentAuthorizationResult>;

  /**
   * Generate a merchant-side reference for this authorization request.
   * The real gateway may ignore this and return its own reference.
   */
  generateReference(): string;
}
