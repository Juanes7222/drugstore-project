/**
 * UI / navigation state types.
 */

export type PosScreen = "sales" | "payment" | "receipt";

export type SaleCompletionPhase =
  | "idle"
  | "initiating"
  | "completing"
  | "completed";

export interface UiState {
  activeScreen: PosScreen;
  saleCompletionPhase: SaleCompletionPhase;
}
