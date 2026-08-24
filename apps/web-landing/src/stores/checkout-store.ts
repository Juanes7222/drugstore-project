import { create } from 'zustand';
import { BillingPeriod, type BillingPeriod as BillingPeriodType } from '@pharmacy/shared-types';

interface CheckoutState {
  isOpen: boolean;
  planCode: string;
  billingPeriod: BillingPeriod;
  openCheckout: (planCode: string, billingPeriod?: BillingPeriod) => void;
  setBillingPeriod: (period: BillingPeriod) => void;
  closeCheckout: () => void;
}

/**
 * Presentation-only store for the checkout dialog: which plan/period the
 * visitor is buying and whether the dialog is open. All money math and
 * persistence stay in lib/format.ts and the server.
 */
export const useCheckoutStore = create<CheckoutState>((set) => ({
  isOpen: false,
  planCode: 'PROVIDER',
  billingPeriod: BillingPeriod.MONTHLY,
  openCheckout: (planCode, billingPeriod: BillingPeriodType = BillingPeriod.MONTHLY) =>
    set({ isOpen: true, planCode, billingPeriod }),
  setBillingPeriod: (billingPeriod) => set({ billingPeriod }),
  closeCheckout: () => set({ isOpen: false }),
}));
