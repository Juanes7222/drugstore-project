/**
 * Payment state types — independent of any payment-gateway implementation.
 */

export const PaymentMethodType = {
  CASH: "cash",
  CARD: "card",
  TRANSFER: "transfer",
  NEQUI: "nequi",
} as const;

export type PaymentMethodType =
  (typeof PaymentMethodType)[keyof typeof PaymentMethodType];

export type ElectronicPaymentMethodType = Exclude<
  PaymentMethodType,
  typeof PaymentMethodType.CASH
>;

export const AuthorizationStatus = {
  IDLE: "idle",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type AuthorizationStatus =
  (typeof AuthorizationStatus)[keyof typeof AuthorizationStatus];

export interface PaymentMethodEntry {
  id: string;
  type: PaymentMethodType;
  amountCents: number;
  authorizationStatus: AuthorizationStatus;
  reference?: string;
  rejectionReason?: string;
}

export interface PaymentState {
  methods: PaymentMethodEntry[];
  cashReceivedCents: number;
}
