/**
 * Mock payment gateway service for Phase 3.
 *
 * Simulates a card/transfer terminal or PSP with realistic latency and three
 * possible outcomes: approved, rejected-insufficient-funds, rejected-timeout.
 * The UI already treats authorization as an async state machine, so replacing
 * this factory with a real integration requires no component or slice changes.
 */
import {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
  PaymentGatewayService,
} from "./payment-gateway-service";

const MIN_DELAY_MS = 600;
const MAX_DELAY_MS = 1400;

const randomDelay = (): number =>
  Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;

let referenceSequence = 0;

const createReference = (): string => {
  referenceSequence += 1;
  const timestamp = Date.now().toString(36).toUpperCase();
  return `POS-${timestamp}-${String(referenceSequence).padStart(4, "0")}`;
};

export interface MockPaymentGatewayOptions {
  /**
   * When true, every authorization is approved. Useful for demos and tests
   * that need deterministic success.
   */
  approveAll?: boolean;
}

export const createMockPaymentGatewayService = (
  options: MockPaymentGatewayOptions = {},
): PaymentGatewayService => ({
  authorize: async (
    _request: PaymentAuthorizationRequest,
  ): Promise<PaymentAuthorizationResult> => {
    await new Promise((resolve) => {
      setTimeout(resolve, randomDelay());
    });

    if (options.approveAll) {
      return {
        status: "approved",
        reference: createReference(),
      };
    }

    const roll = Math.random();

    if (roll < 0.75) {
      return {
        status: "approved",
        reference: createReference(),
      };
    }

    if (roll < 0.9) {
      return {
        status: "rejected",
        rejectionReason: "Fondos insuficientes / Insufficient funds",
      };
    }

    return {
      status: "rejected",
      rejectionReason: "Tiempo de respuesta agotado / Gateway timeout",
    };
  },

  generateReference: (): string => createReference(),
});
