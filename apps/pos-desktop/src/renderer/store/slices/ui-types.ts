/**
 * UI / navigation state types.
 */

export type PosScreen =
  | "home"
  | "login"
  | "sales"
  | "payment"
  | "receipt"
  | "returns"
  | "inventory-adjustments"
  | "prescriptions"
  | "products"
  | "admin-menu"
  | "sync-health"
  | "recovery"
  | "user-management"
  | "audit-log"
  | "about"
  | "forgot-password"
  | "reset-password"
  | "2fa-setup";

export type SaleCompletionPhase =
  | "idle"
  | "initiating"
  | "completing"
  | "completed";

/**
 * Tracks the prescription-interception flow that interrupts payment
 * confirmation when one or more cart items require a prescription.
 */
export interface PrescriptionFlowState {
  /** The sale ID being processed (generated locally during interception). */
  pendingSaleId: string | null;
  /** The specific sale-item ID the prescription form is currently showing. */
  pendingItemId: string | null;
  /** All item IDs that still need a prescription attached. */
  incompleteItemIds: string[];
}

export interface UiState {
  activeScreen: PosScreen;
  saleCompletionPhase: SaleCompletionPhase;
  prescriptionFlow: PrescriptionFlowState;
}
