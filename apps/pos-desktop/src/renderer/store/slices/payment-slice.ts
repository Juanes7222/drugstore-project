/**
 * Redux Toolkit slice owning the payment entry state for the active sale.
 *
 * Responsibilities:
 *   - Track payment methods (real DB `PaymentMethod` rows), their amounts,
 *     and electronic authorization status.
 *   - Track cash received and expose computed change.
 *   - Provide selectors that determine whether the payment can be confirmed.
 *
 * This slice intentionally knows nothing about the payment gateway or the
 * database: entries reference the real `paymentMethodId` + DIAN `category`
 * chosen by the shared `PaymentMethodPicker` (populated from the local DB).
 * It only stores the authorization status that a gateway service reports.
 */
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  AuthorizationStatus,
  PaymentMethodEntry,
  PaymentMethodOption,
  PaymentState,
} from "./payment-types";
import { selectGrandTotalCents } from "./sales-slice";

let methodIdSequence = 0;

const createMethodId = (): string => {
  methodIdSequence += 1;
  return `pm-${methodIdSequence}`;
};

/**
 * Create an unresolved payment entry. The `PaymentProcessing` component fills
 * the real `paymentMethodId`/`category`/`name`/`isCash` from the DB-supplied
 * method list right after the screen mounts (and when the user adds a row).
 */
const createEmptyMethod = (): PaymentMethodEntry => ({
  id: createMethodId(),
  paymentMethodId: "",
  category: "",
  name: "",
  isCash: false,
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
          ...createEmptyMethod(),
          amountCents: action.payload.totalCents,
        },
      ];
      state.cashReceivedCents = 0;
    },

    /**
     * Add a new payment row for the given DB payment method. The caller
     * (PaymentProcessing) decides which method to offer next from the
     * active methods list — the slice never hardcodes a method list.
     */
    addPaymentMethod: (state, action: PayloadAction<PaymentMethodOption>) => {
      state.methods.push({
        ...createEmptyMethod(),
        paymentMethodId: action.payload.id,
        category: action.payload.category,
        name: action.payload.name,
        isCash: action.payload.isCash,
      });
    },

    removePaymentMethod: (state, action: PayloadAction<string>) => {
      if (state.methods.length <= 1) {
        return;
      }
      state.methods = state.methods.filter(
        (method) => method.id !== action.payload,
      );
    },

    /**
     * Change the DB payment method backing a row. Resets authorization state
     * because a different gateway/terminal is now in play.
     */
    updatePaymentMethod: (
      state,
      action: PayloadAction<{
        id: string;
        method: PaymentMethodOption;
      }>,
    ) => {
      const method = state.methods.find((m) => m.id === action.payload.id);
      if (!method) {
        return;
      }

      method.paymentMethodId = action.payload.method.id;
      method.category = action.payload.method.category;
      method.name = action.payload.method.name;
      method.isCash = action.payload.method.isCash;
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

      if (!method.isCash) {
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
  updatePaymentMethod,
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
): boolean =>
  !method.isCash && method.category !== "CREDIT";

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

/**
 * Paid minus total due. The total is the grand total — cart + tax + any
 * delivery fee — so the difference stays 0 when a domicilio fee is present
 * and correctly drives `selectCanConfirmPayment`.
 */
export const selectPaymentDifferenceCents = createSelector(
  [selectPaymentTotalPaidCents, selectGrandTotalCents],
  (paid, total) => paid - total,
);

export const selectCashOwedCents = createSelector(
  [selectPaymentMethods],
  (methods) =>
    methods.reduce(
      (sum, method) =>
        method.isCash ? sum + method.amountCents : sum,
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

/**
 * Payment can be confirmed when the split is exact, every electronic method
 * is approved (or zero), nothing is pending, and every row is backed by a
 * real DB payment method.
 */
export const selectCanConfirmPayment = createSelector(
  [
    selectPaymentDifferenceCents,
    selectAreElectronicMethodsApproved,
    selectHasPendingElectronicMethods,
    selectPaymentMethods,
  ],
  (difference, allApproved, hasPending, methods) =>
    difference === 0 &&
    allApproved &&
    !hasPending &&
    methods.every((method) => method.paymentMethodId !== ""),
);
