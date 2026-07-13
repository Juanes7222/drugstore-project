/**
 * Component tests for ProductSearch.
 *
 * Covers: search with results, empty results, loading state, error
 * handling, selection callback, Escape key clearing, and product
 * badges (low stock, near expiry, restricted, incomplete data).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductSearch } from "./product-search";
import { CatalogItem, CatalogService } from "@/services/catalog-service";
import { SaleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockService = (
  results: CatalogItem[],
  delay = 0,
): CatalogService => ({
  search: vi.fn(
    () =>
      new Promise<CatalogItem[]>((resolve) =>
        setTimeout(() => resolve(results), delay),
      ),
  ),
});

const baseProduct = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "p-001",
  name: "Acetaminofén 500mg",
  genericName: "Paracetamol",
  barcode: "7701234567890",
  invimaCertificate: "INVIMA-2019M-001234",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: false,
  isRestricted: false,
  unitPriceCents: 6_200,
  taxPercentage: 19,
  currentStock: 45,
  minimumStock: 10,
  isActive: true,
  lotCode: "L24056",
  lotExpirationDate: "2027-06-01",
  hasCompleteData: true,
  ...overrides,
});

const renderProductSearch = (
  service: CatalogService,
  onSelect = vi.fn(),
) =>
  render(
    <ProductSearch catalogService={service} onSelect={onSelect} />,
  );

const typeInSearch = (value: string) => {
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value } });
  return input;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ProductSearch", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("PS-01: search with results", () => {
    it("renders product cards when items are returned", async () => {
      const service = createMockService([
        baseProduct({ id: "p-001", name: "Acetaminofén 500mg" }),
        baseProduct({ id: "p-002", name: "Loratadina 10mg" }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });
      expect(screen.getByText("Loratadina 10mg")).toBeInTheDocument();
    });
  });

  describe("PS-02: search without results", () => {
    it("shows a 'no results' message when the search returns empty", async () => {
      const service = createMockService([]);
      renderProductSearch(service);

      typeInSearch("zzzzzz");

      await waitFor(() => {
        expect(
          screen.getByText("No se encontraron productos"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("PS-04: product selection", () => {
    it("calls onSelect when a product card is clicked", async () => {
      const product = baseProduct({ id: "p-001", name: "Acetaminofén 500mg" });
      const service = createMockService([product]);
      const onSelect = vi.fn();
      renderProductSearch(service, onSelect);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      // Find the option card and click it
      const card = screen.getByRole("option", { name: /Acetaminofén/ });
      fireEvent.click(card);

      expect(onSelect).toHaveBeenCalledWith(product);
    });

    it("does not call onSelect when the card has incomplete data", async () => {
      const product = baseProduct({
        id: "p-001",
        hasCompleteData: false,
        unitPriceCents: null,
      });
      const service = createMockService([product]);
      const onSelect = vi.fn();
      renderProductSearch(service, onSelect);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(
          screen.getByText("Datos incompletos"),
        ).toBeInTheDocument();
      });

      const card = screen.getByRole("option");
      expect(card).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(card);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("PS-05: loading state", () => {
    it("shows a loading indicator while the search is in flight", async () => {
      // Use a delayed promise so loading is visible before it resolves
      const service = {
        search: vi.fn(
          () =>
            new Promise<CatalogItem[]>((resolve) =>
              setTimeout(() => resolve([baseProduct()]), 100),
            ),
        ),
      };
      renderProductSearch(service);

      typeInSearch("acetamino");

      // Loading should be visible immediately after typing
      expect(screen.getByText("Cargando...")).toBeInTheDocument();

      // Wait for the search to finish
      await waitFor(() => {
        expect(screen.queryByText("Cargando...")).not.toBeInTheDocument();
      });
    });
  });

  describe("error handling", () => {
    it("shows an error message when the search fails", async () => {
      const service = {
        search: vi.fn(() => Promise.reject(new Error("Network error"))),
      };
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(
          screen.getByText(/No se pudo consultar el catálogo/),
        ).toBeInTheDocument();
      });
    });

    it("shows the error detail in the alert", async () => {
      const service = {
        search: vi.fn(() => Promise.reject(new Error("Network error"))),
      };
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(
          screen.getByRole("alert"),
        ).toHaveTextContent(/Network error/);
      });
    });
  });

  describe("PS-06: low stock badge", () => {
    it("shows a low-stock badge when currentStock <= minimumStock", async () => {
      const service = createMockService([
        baseProduct({ currentStock: 3, minimumStock: 10 }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("STOCK BAJO")).toBeInTheDocument();
      });
    });
  });

  describe("PS-07: near expiry badge", () => {
    it("shows a near-expiry badge when the lot expires within 30 days", async () => {
      const nearFuture = new Date();
      nearFuture.setDate(nearFuture.getDate() + 15);
      const expiryDate = nearFuture.toISOString().slice(0, 10);

      const service = createMockService([
        baseProduct({ lotExpirationDate: expiryDate }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("VENCE PRONTO")).toBeInTheDocument();
      });
    });

    it("does not show near-expiry for a distant expiration date", async () => {
      const service = createMockService([
        baseProduct({ lotExpirationDate: "2028-12-01" }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });
      expect(screen.queryByText("VENCE PRONTO")).not.toBeInTheDocument();
    });
  });

  describe("PS-08: restricted badge", () => {
    it("shows a restricted badge for controlled substances", async () => {
      const service = createMockService([
        baseProduct({
          saleType: SaleType.CONTROLLED_SUBSTANCE,
          requiresPrescription: true,
          isRestricted: true,
        }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("VENTA RESTRINGIDA")).toBeInTheDocument();
      });
    });

    it("shows a restricted badge when requiresPrescription is true", async () => {
      const service = createMockService([
        baseProduct({
          saleType: SaleType.PRESCRIPTION,
          requiresPrescription: true,
          isRestricted: false,
        }),
      ]);
      renderProductSearch(service);

      typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("VENTA RESTRINGIDA")).toBeInTheDocument();
      });
    });
  });

  describe("PS-10: Escape clears results", () => {
    it("clears the input and results when Escape is pressed", async () => {
      const service = createMockService([baseProduct()]);
      renderProductSearch(service);

      const input = typeInSearch("acetamino");

      await waitFor(() => {
        expect(screen.getByText("Acetaminofén 500mg")).toBeInTheDocument();
      });

      fireEvent.keyDown(input, { key: "Escape" });

      // Input should be cleared and results removed
      expect(input).toHaveValue("");
      expect(
        screen.queryByText("Acetaminofén 500mg"),
      ).not.toBeInTheDocument();
    });
  });
});
