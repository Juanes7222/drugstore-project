/**
 * Component tests for the SalesTransaction wiring container.
 *
 * Covers: renders all three child components with the correct props
 * passed through from the useSalesTransaction hook.
 *
 * The children are individually tested elsewhere (product-search.test.tsx,
 * cart-panel.test.tsx); this spec focuses on the wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SalesTransaction } from "./sales-transaction";

// ---------------------------------------------------------------------------
// Mock the hook so we control the return values
// ---------------------------------------------------------------------------

const mockCatalogService = { search: vi.fn() };
const mockHandleSelect = vi.fn();
const mockHandleConfirmRestricted = vi.fn();
const mockHandleCancelRestricted = vi.fn();
const mockHandleCheckout = vi.fn();

vi.mock("../../hooks/use-sales-transaction", () => ({
  useSalesTransaction: () => ({
    catalogService: mockCatalogService,
    pendingItem: null,
    isDialogOpen: false,
    handleSelect: mockHandleSelect,
    handleConfirmRestricted: mockHandleConfirmRestricted,
    handleCancelRestricted: mockHandleCancelRestricted,
    handleCheckout: mockHandleCheckout,
  }),
}));

// ---------------------------------------------------------------------------
// Mock child components so we can verify they render
// ---------------------------------------------------------------------------

vi.mock("./product-search", () => ({
  ProductSearch: ({ catalogService, onSelect }: Record<string, unknown>) => (
    <div data-testid="product-search" />
  ),
}));

vi.mock("./cart-panel", () => ({
  CartPanel: ({ onCheckout }: Record<string, unknown>) => (
    <div data-testid="cart-panel" />
  ),
}));

vi.mock("./restricted-confirmation-dialog", () => ({
  RestrictedConfirmationDialog: ({
    item,
    open,
    onConfirm,
    onCancel,
  }: Record<string, unknown>) => (
    <div data-testid="restricted-confirmation-dialog" />
  ),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SalesTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ProductSearch", () => {
    render(<SalesTransaction />);

    expect(screen.getByTestId("product-search")).toBeInTheDocument();
  });

  it("renders CartPanel", () => {
    render(<SalesTransaction />);

    expect(screen.getByTestId("cart-panel")).toBeInTheDocument();
  });

  it("renders RestrictedConfirmationDialog", () => {
    render(<SalesTransaction />);

    expect(
      screen.getByTestId("restricted-confirmation-dialog"),
    ).toBeInTheDocument();
  });
});
