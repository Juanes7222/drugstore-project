/**
 * Page-level wiring tests for ProductsPage: the import button is role-gated
 * through canImportEntity and the page refreshes its product list when the
 * import wizard reports a successful run (onImported → loadProducts).
 *
 * The heavy sibling components are stubbed; the import-dialog module is
 * replaced by a stub that fires onImported, keeping the real canImportEntity.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { type FC } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleType } from "@pharmacy/shared-types";
import { ProductsPage } from "./products.page";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { StubImportDialog, currentRole } = vi.hoisted(() => {
  const StubImportDialog: FC<{
    open: boolean;
    onImported?: () => void;
  }> = ({ open, onImported }) =>
    open ? (
      <button type="button" onClick={() => onImported?.()}>
        stub-import-done
      </button>
    ) : null;
  return { StubImportDialog, currentRole: { value: undefined as RoleType | undefined } };
});

const mockProductService = {
  listProducts: vi.fn().mockResolvedValue({ items: [] }),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
};

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => vi.fn(),
}));

vi.mock("@/store/slices/ui-slice", () => ({
  navigateBackToSales: () => ({ type: "ui/navigateBackToSales" }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../common/service-context", () => ({
  useProductService: () => mockProductService,
}));

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ session: { role: currentRole.value } }),
}));

vi.mock("./product-list", () => ({
  ProductList: () => <div data-testid="product-list" />,
}));

vi.mock("./product-form", () => ({
  ProductForm: () => <div data-testid="product-form" />,
}));

vi.mock("./use-product-form-data", () => ({
  useProductFormData: () => ({
    categories: [],
    pharmaceuticalForms: [],
    taxSchemes: [],
    defaultTaxSchemeId: null,
    defaultSaleType: "FREE_SALE",
    fieldRequirements: {},
  }),
}));

vi.mock("../data-import/import-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data-import/import-dialog")>();
  return { ...actual, ImportDialog: StubImportDialog };
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ProductsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = RoleType.INVENTORY_ASSISTANT;
    mockProductService.listProducts.mockResolvedValue({ items: [] });
  });

  it("shows the import entry button for inventory assistants", async () => {
    render(<ProductsPage />);

    const importButton = await screen.findByRole("button", {
      name: "Importar CSV/Excel",
    });
    expect(importButton).toBeVisible();
  });

  it("hides the import entry button for roles without permission", async () => {
    currentRole.value = RoleType.CASHIER;
    render(<ProductsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("product-list")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Importar CSV/Excel" }),
    ).not.toBeInTheDocument();
  });

  it("reloads the product list after a successful import", async () => {
    const user = userEvent.setup();
    render(<ProductsPage />);

    const importButton = await screen.findByRole("button", {
      name: "Importar CSV/Excel",
    });
    await user.click(importButton);

    // The wizard stub opens; fire its onImported callback as a completed run.
    const done = screen.getByRole("button", { name: "stub-import-done" });
    expect(mockProductService.listProducts).toHaveBeenCalledTimes(1);
    await user.click(done);

    await waitFor(() => {
      expect(mockProductService.listProducts).toHaveBeenCalledTimes(2);
    });
  });
});