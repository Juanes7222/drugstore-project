/**
 * Held-cart persistence — set-aside carts (F8) survive app restarts.
 *
 * Held carts are stored as a JSON snapshot in localStorage. The snapshot
 * keeps the prices and lot data from the moment the cart was set aside;
 * recalling a cart restores exactly what the cashier left, even if the
 * catalog changed in the meantime (snapshot semantics, matching the
 * SaleItem snapshot behaviour at confirm time).
 *
 * The payload is small and capped: a held cart is a handful of line items.
 * Corrupt or unparseable data is ignored (treated as "no held carts") so a
 * bad write can never break the sales screen.
 */
import { type HeldCart } from "./slices/sales-types";

const STORAGE_KEY = "pos-held-carts";

/** Max held carts kept across restarts; oldest are dropped on save. */
const MAX_HELD_CARTS = 10;

const isHeldCart = (value: unknown): value is HeldCart => {
  if (typeof value !== "object" || value === null) return false;
  const cart = value as Record<string, unknown>;
  return (
    typeof cart.id === "string" &&
    typeof cart.savedAt === "number" &&
    Array.isArray(cart.items)
  );
};

/**
 * Load held carts from localStorage. Returns [] on any failure (missing
 * key, corrupt JSON, wrong shape) — the sales screen must never crash
 * because of a bad storage read.
 */
export function loadHeldCarts(): HeldCart[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHeldCart).slice(0, MAX_HELD_CARTS);
  } catch {
    return [];
  }
}

/**
 * Persist the current held-cart list. Silently no-ops when storage is
 * unavailable (private mode, quota, jsdom).
 */
export function saveHeldCarts(heldCarts: HeldCart[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(heldCarts.slice(0, MAX_HELD_CARTS)),
    );
  } catch {
    // Storage failures must never break the sale flow.
  }
}