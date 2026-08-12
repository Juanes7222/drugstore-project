/**
 * Payment state types — independent of any payment-gateway implementation.
 *
 * The source of truth for payment methods is the local database
 * (`PaymentMethod` rows, populated by the server's `pos-settings` sync with
 * DIAN categories). The UI never hardcodes a payment-method list: every entry
 * carries the real `paymentMethodId` plus its DIAN `category` and `isCash`
 * flag, so sales, fiscal adjustments and returns always agree.
 */

/** A single payment method as stored in the local DB and exposed by
 *  `CashShiftService.getActivePaymentMethodsList()`. */
export interface PaymentMethodOption {
  id: string;
  category: string;
  name: string;
  isCash: boolean;
}

export const AuthorizationStatus = {
  IDLE: "idle",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type AuthorizationStatus =
  (typeof AuthorizationStatus)[keyof typeof AuthorizationStatus];

export interface PaymentMethodEntry {
  /** Local row id (`pm-1`, `pm-2`, …) used for list keys and row updates. */
  id: string;
  /** Real `PaymentMethod.id` from the local DB. */
  paymentMethodId: string;
  /** DIAN category of the selected method (CASH, DEBIT_CARD, …). */
  category: string;
  /** Cashier-facing name of the selected method. */
  name: string;
  /** Whether the selected method is cash (drives change calculation). */
  isCash: boolean;
  amountCents: number;
  authorizationStatus: AuthorizationStatus;
  reference?: string;
  rejectionReason?: string;
}

export interface PaymentState {
  methods: PaymentMethodEntry[];
  cashReceivedCents: number;
}
