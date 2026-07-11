/**
 * Shared types for the Inventory Adjustments feature's presentational components.
 *
 * @module inventory-adjustments.types
 */

export type AdjustmentType = "INCREASE" | "DECREASE";

export interface DisplayLot {
  id: string;
  productId: string;
  productName: string;
  lotCode: string;
  currentStock: number;
  expirationDate: string;
  location: string;
}

export type AdjustmentReason =
  | "DAMAGED"
  | "EXPIRED"
  | "LOSS"
  | "FOUND"
  | "OTHER";
