/**
 * Shared types for cash-shift wizard components.
 *
 * @category Types
 */

/** Sales summary for a shift, returned by getShiftSalesSummary. */
export interface ShiftSummary {
  transactionCount: number;
  totalSalesAmount: string;
  totalsByPaymentMethod: Array<{
    paymentMethodId: string;
    methodName: string;
    isCash: boolean;
    expectedAmount: string;
  }>;
}

/** A single declared count per payment method. */
export interface CountEntry {
  paymentMethodId: string;
  declaredAmount: number;
}

/** Close wizard state machine. */
export type CloseWizardStep =
  | { step: 'idle' }
  | { step: 'summary'; data: ShiftSummary }
  | { step: 'count'; data: ShiftSummary }
  | { step: 'confirm'; data: { summary: ShiftSummary; counts: CountEntry[] } }
  | { step: 'closing' }
  | { step: 'done' };

/** Page-level state (no shift / open / loading). */
export type PageState =
  | { status: 'loading' }
  | { status: 'no-shift' }
  | { status: 'open' };
