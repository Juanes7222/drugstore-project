/**
 * Unit tests for the payment slice and its selectors.
 */
import { describe, expect, it } from "vitest";
import {
  addPaymentMethod,
  initializePayment,
  paymentSlice,
  removePaymentMethod,
  selectAreElectronicMethodsApproved,
  selectCanConfirmPayment,
  selectCashOwedCents,
  selectPaymentChangeCents,
  selectPaymentDifferenceCents,
  selectPaymentTotalPaidCents,
  setAuthorizationStatus,
  setCashReceived,
  updatePaymentMethodAmount,
  updatePaymentMethodType,
} from "./payment-slice";
import { PaymentMethodType } from "./payment-types";
import { salesSlice } from "./sales-slice";
import { SaleType } from "@pharmacy/shared-types";

const baseCartItem = {
  id: "line-1",
  productId: "p-001",
  name: "Test product",
  genericName: "Test generic",
  invimaCertificate: "INVIMA-TEST",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  lotCode: "L1",
  lotExpirationDate: "2027-01-01",
  taxPercentage: 19,
  quantity: 1,
};

interface TestRootState {
  sales: ReturnType<typeof salesSlice.reducer>;
  payment: ReturnType<typeof paymentSlice.reducer>;
}

const createRootState = (totalCents: number): TestRootState => {
  // The sales selector always applies a 19% tax rate, so back out a unit
  // price that produces the requested grand total.
  const unitPriceCents = Math.round(totalCents / 1.19);

  return {
    sales: salesSlice.reducer(
      salesSlice.getInitialState(),
      salesSlice.actions.addItem({
        ...baseCartItem,
        unitPriceCents,
      }),
    ),
    payment: paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents }),
    ),
  };
};

const applyPaymentAction = (
  root: TestRootState,
  action: ReturnType<typeof paymentSlice.actions[keyof typeof paymentSlice.actions]>,
): TestRootState => ({
  ...root,
  payment: paymentSlice.reducer(root.payment, action),
});

describe("payment slice", () => {
  it("initializes with a single cash method covering the total", () => {
    const state = paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents: 66_164 }),
    );

    expect(state.methods).toHaveLength(1);
    expect(state.methods[0]?.type).toBe(PaymentMethodType.CASH);
    expect(state.methods[0]?.amountCents).toBe(66_164);
    expect(state.cashReceivedCents).toBe(0);
  });

  it("adds a non-cash method when a cash method already exists", () => {
    let state = paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents: 66_164 }),
    );
    state = paymentSlice.reducer(state, addPaymentMethod());

    expect(state.methods).toHaveLength(2);
    expect(state.methods[1]?.type).toBe(PaymentMethodType.CARD);
  });

  it("recomputes authorization to idle when an electronic amount changes", () => {
    let state = paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents: 66_164 }),
    );
    state = paymentSlice.reducer(state, addPaymentMethod());
    const cardId = state.methods[1]?.id as string;

    state = paymentSlice.reducer(
      state,
      setAuthorizationStatus({ id: cardId, status: "approved", reference: "X" }),
    );
    state = paymentSlice.reducer(
      state,
      updatePaymentMethodAmount({ id: cardId, amountCents: 10_000 }),
    );

    const card = state.methods.find((m) => m.id === cardId);
    expect(card?.authorizationStatus).toBe("idle");
    expect(card?.reference).toBeUndefined();
  });

  it("does not remove the last remaining method", () => {
    let state = paymentSlice.reducer(
      paymentSlice.getInitialState(),
      initializePayment({ totalCents: 66_164 }),
    );
    const onlyId = state.methods[0]?.id as string;
    state = paymentSlice.reducer(state, removePaymentMethod(onlyId));

    expect(state.methods).toHaveLength(1);
  });
});

describe("payment selectors", () => {
  it("reports exact cash payment as ready", () => {
    const root = createRootState(66_164);

    expect(selectPaymentDifferenceCents(root)).toBe(0);
    expect(selectAreElectronicMethodsApproved(root)).toBe(true);
    expect(selectCanConfirmPayment(root)).toBe(true);
  });

  it("reports a missing amount when the split is short", () => {
    const root = createRootState(66_164);
    const cashId = root.payment.methods[0]?.id as string;
    const nextRoot = applyPaymentAction(
      root,
      updatePaymentMethodAmount({ id: cashId, amountCents: 50_000 }),
    );

    expect(selectPaymentTotalPaidCents(nextRoot)).toBe(50_000);
    expect(selectPaymentDifferenceCents(nextRoot)).toBe(-16_164);
    expect(selectCanConfirmPayment(nextRoot)).toBe(false);
  });

  it("reports an excess amount when the split is too high", () => {
    const root = createRootState(66_164);
    const cashId = root.payment.methods[0]?.id as string;
    const nextRoot = applyPaymentAction(
      root,
      updatePaymentMethodAmount({ id: cashId, amountCents: 70_000 }),
    );

    expect(selectPaymentDifferenceCents(nextRoot)).toBe(3_836);
    expect(selectCanConfirmPayment(nextRoot)).toBe(false);
  });

  it("blocks confirmation until electronic methods are approved", () => {
    let root = createRootState(66_164);
    root = applyPaymentAction(root, addPaymentMethod());
    const cashId = root.payment.methods[0]?.id as string;
    const cardId = root.payment.methods[1]?.id as string;

    root = applyPaymentAction(
      root,
      updatePaymentMethodAmount({ id: cashId, amountCents: 40_000 }),
    );
    root = applyPaymentAction(
      root,
      updatePaymentMethodAmount({ id: cardId, amountCents: 26_164 }),
    );

    expect(selectPaymentDifferenceCents(root)).toBe(0);
    expect(selectAreElectronicMethodsApproved(root)).toBe(false);
    expect(selectCanConfirmPayment(root)).toBe(false);

    root = applyPaymentAction(
      root,
      setAuthorizationStatus({ id: cardId, status: "approved", reference: "A" }),
    );

    expect(selectAreElectronicMethodsApproved(root)).toBe(true);
    expect(selectCanConfirmPayment(root)).toBe(true);
  });

  it("calculates change for exact and over-received cash", () => {
    let root = createRootState(66_164);

    expect(selectCashOwedCents(root)).toBe(66_164);

    root = applyPaymentAction(root, setCashReceived(66_164));
    expect(selectPaymentChangeCents(root)).toBe(0);

    root = applyPaymentAction(root, setCashReceived(100_000));
    expect(selectPaymentChangeCents(root)).toBe(33_836);

    root = applyPaymentAction(root, setCashReceived(50_000));
    expect(selectPaymentChangeCents(root)).toBe(-16_164);
  });

  it("resets electronic approval when the method type changes", () => {
    let root = createRootState(66_164);
    root = applyPaymentAction(root, addPaymentMethod());
    const cardId = root.payment.methods[1]?.id as string;

    root = applyPaymentAction(
      root,
      updatePaymentMethodAmount({ id: cardId, amountCents: 26_164 }),
    );
    root = applyPaymentAction(
      root,
      setAuthorizationStatus({ id: cardId, status: "approved", reference: "A" }),
    );
    root = applyPaymentAction(
      root,
      updatePaymentMethodType({ id: cardId, type: PaymentMethodType.TRANSFER }),
    );

    const method = root.payment.methods.find((m) => m.id === cardId);
    expect(method?.authorizationStatus).toBe("idle");
    expect(method?.reference).toBeUndefined();
  });
});
