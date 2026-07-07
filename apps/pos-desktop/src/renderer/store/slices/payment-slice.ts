/**
 * Redux Toolkit slice owning the payment entry state for the active sale.
 *
 * Responsibilities:
 *   - Track payment methods, their amounts, and electronic authorization status.
 *   - Track cash received and expose computed change.
 *   - Provide selectors that determine whether the payment can be confirmed.
 *
 * This slice intentionally knows nothing about the payment gateway. It only
 * stores the authorization status that a gateway service reports back.
 */
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  AuthorizationStatus,
  ElectronicPaymentMethodType,
  PaymentMethodEntry,
  PaymentMethodType,
  PaymentState,
} from "./payment-types";
import { selectTotalCents } from "./sales-slice";

const ELECTRONIC_METHODS: readonly PaymentMethodType[] = [
  PaymentMethodType.CARD,
  PaymentMethodType.TRANSFER,
  PaymentMethodType.NEQUI,
];

let methodIdSequence = 0;

const createMethodId = (): string => {
  methodIdSequence += 1;
  return `pm-${methodIdSequence}`;
};

const createEmptyMethod = (
  type: PaymentMethodType = PaymentMethodType.CASH,
): PaymentMethodEntry => ({
  id: createMethodId(),
  type,
  amountCents: 0,
  authorizationStatus: AuthorizationStatus.IDLE,
});

const initialState: PaymentState = {
  methods: [],
  cashReceivedCents: 0,
};

export const paymentSlice = createSlice({
  name: "payment",
  initialState,
  reducers: {
    initializePayment: (
      state,
      action: PayloadAction<{ totalCents: number }>,
    ) => {
      state.methods = [
        {
          id: createMethodId(),
          type: PaymentMethodType.CASH,
          amountCents: action.payload.totalCents,
          authorizationStatus: AuthorizationStatus.IDLE,
        },
      ];
      state.cashReceivedCents = 0;
    },

    addPaymentMethod: (state) => {
      const hasCash = state.methods.some(
        (method) => method.type === PaymentMethodType.CASH,
      );
      state.methods.push(
        createEmptyMethod(
          hasCash ? PaymentMethodType.CARD : PaymentMethodType.CASH,
        ),
      );
    },

    removePaymentMethod: (state, action: PayloadAction<string>) => {
      if (state.methods.length <= 1) {
        return;
      }
      state.methods = state.methods.filter(
        (method) => method.id !== action.payload,
      );
    },

    updatePaymentMethodType: (
      state,
      action: PayloadAction<{ id: string; type: PaymentMethodType }>,
    ) => {
      const method = state.methods.find((m) => m.id === action.payload.id);
      if (!method) {
        return;
      }

      method.type = action.payload.type;
      method.authorizationStatus = AuthorizationStatus.IDLE;
      method.reference = undefined;
      method.rejectionReason = undefined;
    },

    updatePaymentMethodAmount: (
      state,
      action: PayloadAction<{ id: string; amountCents: number }>,
    ) => {
      const method = state.methods.find((m) => m.id === action.payload.id);
      if (!method) {
        return;
      }

      method.amountCents = Math.max(0, action.payload.amountCents);

      if (method.type !== PaymentMethodType.CASH) {
        method.authorizationStatus = AuthorizationStatus.IDLE;
        method.reference = undefined;
        method.rejectionReason = undefined;
      }
    },

    setCashReceived: (state, action: PayloadAction<number>) => {
      state.cashReceivedCents = Math.max(0, action.payload);
    },

    setAuthorizationStatus: (
      state,
      action: PayloadAction<{
        id: string;
        status: AuthorizationStatus;
        reference?: string;
        rejectionReason?: string;
      }>,
    ) => {
      const method = state.methods.find((m) => m.id === action.payload.id);
      if (!method) {
        return;
      }

      method.authorizationStatus = action.payload.status;
      method.reference = action.payload.reference;
      method.rejectionReason = action.payload.rejectionReason;
    },

    resetPayment: (state) => {
      state.methods = initialState.methods;
      state.cashReceivedCents = initialState.cashReceivedCents;
    },
  },
});

export const {
  initializePayment,
  addPaymentMethod,
  removePaymentMethod,
  updatePaymentMethodType,
  updatePaymentMethodAmount,
  setCashReceived,
  setAuthorizationStatus,
  resetPayment,
} = paymentSlice.actions;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const isElectronicMethod = (
  method: PaymentMethodEntry,
): method is PaymentMethodEntry & {
  type: ElectronicPaymentMethodType;
} => ELECTRONIC_METHODS.includes(method.type);

const selectPaymentState = (state: { payment: PaymentState }): PaymentState =>
  state.payment;

/* ------------------------------------------------------------------ */
/* Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectPaymentMethods = createSelector(
  [selectPaymentState],
  (payment) => payment.methods,
);

export const selectCashReceivedCents = createSelector(
  [selectPaymentState],
  (payment) => payment.cashReceivedCents,
);

export const selectPaymentTotalPaidCents = createSelector(
  [selectPaymentMethods],
  (methods) => methods.reduce((sum, method) => sum + method.amountCents, 0),
);

export const selectPaymentDifferenceCents = createSelector(
  [selectPaymentTotalPaidCents, selectTotalCents],
  (paid, total) => paid - total,
);

export const selectCashOwedCents = createSelector(
  [selectPaymentMethods],
  (methods) =>
    methods.reduce(
      (sum, method) =>
        method.type === PaymentMethodType.CASH ? sum + method.amountCents : sum,
      0,
    ),
);

export const selectPaymentChangeCents = createSelector(
  [selectCashReceivedCents, selectCashOwedCents],
  (received, owed) => received - owed,
);

export const selectHasPendingElectronicMethods = createSelector(
  [selectPaymentMethods],
  (methods) =>
    methods.some(
      (method) =>
        isElectronicMethod(method) &&
        method.authorizationStatus === AuthorizationStatus.PENDING,
    ),
);

export const selectHasRejectedElectronicMethods = createSelector(
  [selectPaymentMethods],
  (methods) =>
    methods.some(
      (method) =>
        isElectronicMethod(method) &&
        method.authorizationStatus === AuthorizationStatus.REJECTED,
    ),
);

export const selectAreElectronicMethodsApproved = createSelector(
  [selectPaymentMethods],
  (methods) =>
    methods
      .filter(isElectronicMethod)
      .every(
        (method) =>
          method.amountCents === 0 ||
          method.authorizationStatus === AuthorizationStatus.APPROVED,
      ),
);

export const selectCanConfirmPayment = createSelector(
  [
    selectPaymentDifferenceCents,
    selectAreElectronicMethodsApproved,
    selectHasPendingElectronicMethods,
  ],
  (difference, allApproved, hasPending) =>
    difference === 0 && allApproved && !hasPending,
);
