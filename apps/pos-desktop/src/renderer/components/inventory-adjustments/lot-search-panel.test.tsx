/**
 * Component tests for LotSearchPanel in isolation.
 *
 * Covers: default display, sorting (near-expiry first), low-stock badge,
 * near-expiry badge (mutually exclusive with low-stock), empty states
 * (no_inventory vs no_results), search input interaction, keyboard
 * selection, processing disabled state, and selected-lot highlighting.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LotSearchPanel } from "./lot-search-panel";
import type { DisplayLot } from "./inventory-adjustments.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

const defaultProps = {
  searchQuery: "",
  onSearchQueryChange: noop,
  isProcessing: false,
  lots: [] as DisplayLot[],
  selectedLot: null as DisplayLot | null,
  onSelectLot: noop,
};

// isNearExpiry checks if expirationDate <= today + 90 days.
// Tests that need deterministic date logic freeze time to 2026-07-16
// so that expiry <= 2026-10-14 is "near expiry".

const lotNormal: DisplayLot = {
  id: "lot-a",
  productId: "p-a",
  productName: "Acetaminofén 500mg",
  lotCode: "L24001",
  currentStock: 50,
  expirationDate: "2027-06-01",
  location: "A1",
};

const lotLowStock: DisplayLot = {
  id: "lot-b",
  productId: "p-b",
  productName: "Ibuprofeno 400mg",
  lotCode: "L24002",
  currentStock: 3,
  expirationDate: "2027-08-01",
  location: "B2",
};

const lotNearExpiry: DisplayLot = {
  id: "lot-c",
  productId: "p-c",
  productName: "Metformina 850mg",
  lotCode: "M85001",
  currentStock: 30,
  expirationDate: "2026-08-15",
  location: "C3",
};

const lotLowStockAndNearExpiry: DisplayLot = {
  id: "lot-d",
  productId: "p-d",
  productName: "Losartán 50mg",
  lotCode: "L50001",
  currentStock: 5,
  expirationDate: "2026-09-01",
  location: "D4",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LotSearchPanel", () => {
  // ── Display ─────────────────────────────────────────────────────────

  describe("display", () => {
    it("renders a search input with placeholder", () => {
      render(<LotSearchPanel {...defaultProps} />);

      expect(
        screen.getByPlaceholderText(
          /Buscar por nombre, lote o ubicación/,
        ),
      ).toBeInTheDocument();
    });

    it("shows lot count chip with the number of lots", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal, lotLowStock]}
        />,
      );

      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("shows 'No hay productos en inventario' when empty and not filtering", () => {
      render(<LotSearchPanel {...defaultProps} lots={[]} />);

      expect(
        screen.getByText(
          "No hay productos en inventario. Sincronice el catálogo desde el servidor.",
        ),
      ).toBeInTheDocument();
    });

    it("shows 'No se encontraron productos o lotes' when empty while filtering", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          searchQuery="ZZZZ"
          lots={[]}
        />,
      );

      expect(
        screen.getByText("No se encontraron productos o lotes."),
      ).toBeInTheDocument();
    });

    it("renders a search region with accessible label", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
        />,
      );

      expect(
        screen.getByRole("search", { name: /Lista de inventario/i }),
      ).toBeInTheDocument();
    });

    it("renders the lot list as a listbox", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
        />,
      );

      expect(
        screen.getByRole("listbox", { name: /Lista de inventario/i }),
      ).toBeInTheDocument();
    });
  });

  // ── Sorting ─────────────────────────────────────────────────────────

  describe("sorting", () => {
    beforeAll(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16"));
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("places near-expiry lots before non-near-expiry lots", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal, lotNearExpiry]}
        />,
      );

      const options = screen.getAllByRole("option");
      // Metformina (near-expiry) should appear before Acetaminofén
      expect(options[0]).toHaveTextContent("Metformina 850mg");
      expect(options[1]).toHaveTextContent("Acetaminofén 500mg");
    });

    it("sorts lots alphabetically within same expiry group", () => {
      const lotA: DisplayLot = {
        ...lotNearExpiry,
        id: "sort-a",
        productName: "A",
      };
      const lotB: DisplayLot = {
        ...lotNearExpiry,
        id: "sort-b",
        productName: "B",
      };

      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal, lotB, lotA]}
        />,
      );

      const options = screen.getAllByRole("option");
      // A and B are near-expiry → sort alphabetically, then C (non-near-expiry)
      expect(options[0]).toHaveTextContent("A");
      expect(options[1]).toHaveTextContent("B");
      expect(options[2]).toHaveTextContent("Acetaminofén");
    });
  });

  // ── Badges ──────────────────────────────────────────────────────────

  describe("badges", () => {
    beforeAll(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16"));
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("shows 'Stock bajo' badge when currentStock <= 10", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotLowStock]}
        />,
      );

      expect(screen.getByText("Stock bajo")).toBeInTheDocument();
    });

    it("does NOT show 'Stock bajo' badge when stock > 10", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
        />,
      );

      expect(screen.queryByText("Stock bajo")).not.toBeInTheDocument();
    });

    it("shows 'Próximo a vencer' badge when expiry within 90 days", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNearExpiry]}
        />,
      );

      expect(
        screen.getByText("Próximo a vencer"),
      ).toBeInTheDocument();
    });

    it("does NOT show 'Próximo a vencer' badge for far-future expiry", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
        />,
      );

      expect(
        screen.queryByText("Próximo a vencer"),
      ).not.toBeInTheDocument();
    });

    it("prefers low-stock badge over near-expiry when both conditions met", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotLowStockAndNearExpiry]}
        />,
      );

      // Code renders nearExpiry && !lowStock, so only "Stock bajo"
      expect(screen.getByText("Stock bajo")).toBeInTheDocument();
      expect(
        screen.queryByText("Próximo a vencer"),
      ).not.toBeInTheDocument();
    });
  });

  // ── Interaction ─────────────────────────────────────────────────────

  describe("interaction", () => {
    it("calls onSearchQueryChange when user types in the search input", async () => {
      const onSearchQueryChange = vi.fn();

      render(
        <LotSearchPanel
          {...defaultProps}
          onSearchQueryChange={onSearchQueryChange}
        />,
      );

      const input = screen.getByPlaceholderText(
        /Buscar por nombre, lote o ubicación/,
      );
      fireEvent.change(input, { target: { value: "ibu" } });

      expect(onSearchQueryChange).toHaveBeenCalledWith("ibu");
    });

    it("disables the search input when isProcessing is true", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          isProcessing={true}
        />,
      );

      expect(
        screen.getByPlaceholderText(
          /Buscar por nombre, lote o ubicación/,
        ),
      ).toBeDisabled();
    });

    it("calls onSelectLot when a lot option is clicked", () => {
      const onSelectLot = vi.fn();

      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
          onSelectLot={onSelectLot}
        />,
      );

      fireEvent.click(screen.getByText("Acetaminofén 500mg"));

      expect(onSelectLot).toHaveBeenCalledWith(lotNormal);
    });

    it("calls onSelectLot when Enter is pressed on a lot option", () => {
      const onSelectLot = vi.fn();

      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal]}
          onSelectLot={onSelectLot}
        />,
      );

      const option = screen.getByRole("option", {
        name: /Acetaminofén/,
      });
      fireEvent.keyDown(option, { key: "Enter", code: "Enter" });

      expect(onSelectLot).toHaveBeenCalledWith(lotNormal);
    });

    it("marks the selected lot with aria-selected=true", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          lots={[lotNormal, lotLowStock]}
          selectedLot={lotNormal}
        />,
      );

      const selectedOption = screen.getByRole("option", {
        name: /Acetaminofén/,
      });
      expect(selectedOption).toHaveAttribute("aria-selected", "true");

      const unselectedOption = screen.getByRole("option", {
        name: /Ibuprofeno/,
      });
      expect(unselectedOption).toHaveAttribute("aria-selected", "false");
    });
  });
});
