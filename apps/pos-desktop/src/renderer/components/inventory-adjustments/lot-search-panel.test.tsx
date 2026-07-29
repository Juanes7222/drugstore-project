/**
 * Component tests for LotSearchPanel in isolation (grouped-by-product layout).
 *
 * Covers: default display, group expand/collapse, group-level alert badges,
 * search filtering (internal), interaction (expand group → select lot row),
 * keyboard selection, processing disabled state, and selected-lot highlighting.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LotSearchPanel } from "./lot-search-panel";
import { LotState } from "@pharmacy/database/local";
import type { ProductLotGroup } from "../../../domain/inventory-lots/inventory-lots.service";
import type { DisplayLot } from "./inventory-adjustments.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

const defaultProps = {
  searchQuery: "",
  onSearchQueryChange: noop,
  isProcessing: false,
  productGroups: [] as ProductLotGroup[],
  selectedLot: null as DisplayLot | null,
  onSelectLot: noop,
};

// isNearExpiry checks if expirationDate <= today + 90 days.
// Tests that need deterministic date logic freeze time to 2026-07-16
// so that expiry <= 2026-10-14 is "near expiry".

// ── Static test groups (no time-dependent logic) ──────────────────────

const groupNormal: ProductLotGroup = {
  productId: "p-a",
  commercialName: "Acetaminofén 500mg",
  genericName: "Acetaminofén",
  internalCode: "ACET-500",
  totalStock: 50,
  lotCount: 1,
  soonToExpireCount: 0,
  expiredCount: 0,
  lowStockCount: 0,
  nearestExpiryDate: new Date("2027-06-01"),
  lots: [{
    id: "lot-a",
    productId: "p-a",
    batchNumber: "L24001",
    currentStock: 50,
    expirationDate: new Date("2027-06-01"),
    state: LotState.ACTIVE,
    locationCode: "A1",
    version: 1,
    entryDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      commercialName: "Acetaminofén 500mg",
      genericName: "Acetaminofén",
      internalCode: "ACET-500",
    },
  } as unknown as ProductLotGroup["lots"][number]],
};

const groupLowStock: ProductLotGroup = {
  productId: "p-b",
  commercialName: "Ibuprofeno 400mg",
  genericName: "Ibuprofeno",
  internalCode: "IBU-400",
  totalStock: 3,
  lotCount: 1,
  soonToExpireCount: 0,
  expiredCount: 0,
  lowStockCount: 1,
  nearestExpiryDate: new Date("2027-08-01"),
  lots: [{
    id: "lot-b",
    productId: "p-b",
    batchNumber: "L24002",
    currentStock: 3,
    expirationDate: new Date("2027-08-01"),
    state: LotState.ACTIVE,
    locationCode: "B2",
    version: 1,
    entryDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      commercialName: "Ibuprofeno 400mg",
      genericName: "Ibuprofeno",
      internalCode: "IBU-400",
    },
  } as unknown as ProductLotGroup["lots"][number]],
};

// Groups for time-sensitive tests (uses fake timers)
const groupNearExpiry: ProductLotGroup = {
  productId: "p-c",
  commercialName: "Metformina 850mg",
  genericName: "Metformina",
  internalCode: "MET-850",
  totalStock: 30,
  lotCount: 1,
  soonToExpireCount: 1,
  expiredCount: 0,
  lowStockCount: 0,
  nearestExpiryDate: new Date("2026-08-15"),
  lots: [{
    id: "lot-c",
    productId: "p-c",
    batchNumber: "M85001",
    currentStock: 30,
    expirationDate: new Date("2026-08-15"),
    state: LotState.ACTIVE,
    locationCode: "C3",
    version: 1,
    entryDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      commercialName: "Metformina 850mg",
      genericName: "Metformina",
      internalCode: "MET-850",
    },
  } as unknown as ProductLotGroup["lots"][number]],
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

    it("shows group count chip with the number of product groups", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal, groupLowStock]}
        />,
      );

      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("shows 'No hay productos en inventario' when empty and not filtering", () => {
      render(<LotSearchPanel {...defaultProps} productGroups={[]} />);

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
          productGroups={[]}
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
          productGroups={[groupNormal]}
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
          productGroups={[groupNormal]}
        />,
      );

      expect(
        screen.getByRole("listbox", { name: /Lista de inventario/i }),
      ).toBeInTheDocument();
    });

    it("renders group headers with commercial name", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal, groupLowStock]}
        />,
      );

      expect(
        screen.getByText("Acetaminofén 500mg"),
      ).toBeInTheDocument();
      expect(screen.getByText("Ibuprofeno 400mg")).toBeInTheDocument();
    });

    it("groups are collapsed by default (no lot options visible)", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      const header = screen.getByRole("button", {
        name: /Acetaminofén/,
      });
      expect(header).toHaveAttribute("aria-expanded", "false");

      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });
  });

  // ── Expand / collapse ───────────────────────────────────────────────

  describe("expand / collapse", () => {
    it("expands a group when its header is clicked", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      const header = screen.getByRole("button", {
        name: /Acetaminofén/,
      });
      fireEvent.click(header);

      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("option")).toBeInTheDocument();
    });

    it("collapses a group when its header is clicked again", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      const header = screen.getByRole("button", {
        name: /Acetaminofén/,
      });
      fireEvent.click(header);
      fireEvent.click(header);

      expect(header).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    it("shows per-lot rows inside an expanded group", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Acetaminofén/ }),
      );

      expect(screen.getByText("L24001")).toBeInTheDocument();
      expect(screen.getByText("· A1")).toBeInTheDocument();
    });
  });

  // ── Group order (service-sorted) ────────────────────────────────────

  describe("group order", () => {
    it("renders groups in the order they are passed via productGroups", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupLowStock, groupNormal]}
        />,
      );

      const headers = screen.getAllByRole("button");
      // Order should match the passed array
      expect(headers[0]).toHaveTextContent("Ibuprofeno 400mg");
      expect(headers[1]).toHaveTextContent("Acetaminofén 500mg");
    });
  });

  // ── Group alerts ────────────────────────────────────────────────────

  describe("group alerts", () => {
    beforeAll(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16"));
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("shows expiring count alert for near-expiry group", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNearExpiry]}
        />,
      );

      expect(
        screen.getByText("1 próximos a vencer"),
      ).toBeInTheDocument();
    });

    it("does NOT show expiring count alert for normal group", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      expect(
        screen.queryByText(/próximos a vencer/),
      ).not.toBeInTheDocument();
    });

    it("shows low-stock count alert for low-stock group", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupLowStock]}
        />,
      );

      expect(screen.getByText("1 bajo stock")).toBeInTheDocument();
    });

    it("shows combined alerts when group has multiple conditions", () => {
      const groupBoth: ProductLotGroup = {
        ...groupNearExpiry,
        lowStockCount: 1,
        lots: [{
          ...groupNearExpiry.lots[0],
          currentStock: 3,
        }] as unknown as ProductLotGroup["lots"],
      };

      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupBoth]}
        />,
      );

      expect(
        screen.getByText("1 próximos a vencer · 1 bajo stock"),
      ).toBeInTheDocument();
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

    it("calls onSelectLot with DisplayLot when a lot option is clicked", () => {
      const onSelectLot = vi.fn();

      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
          onSelectLot={onSelectLot}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Acetaminofén/ }),
      );
      fireEvent.click(screen.getByText("L24001"));

      expect(onSelectLot).toHaveBeenCalledTimes(1);
      const calledWith = onSelectLot.mock.calls[0][0] as DisplayLot;
      expect(calledWith.id).toBe("lot-a");
      expect(calledWith.productId).toBe("p-a");
      expect(calledWith.productName).toBe("Acetaminofén 500mg");
      expect(calledWith.lotCode).toBe("L24001");
      expect(calledWith.currentStock).toBe(50);
      expect(calledWith.expirationDate).toBe("2027-06-01");
      expect(calledWith.location).toBe("A1");
    });

    it("calls onSelectLot when Enter is pressed on a lot option", () => {
      const onSelectLot = vi.fn();

      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
          onSelectLot={onSelectLot}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Acetaminofén/ }),
      );

      const option = screen.getByRole("option", { name: /L24001/ });
      fireEvent.keyDown(option, { key: "Enter", code: "Enter" });

      expect(onSelectLot).toHaveBeenCalledTimes(1);
      expect(onSelectLot.mock.calls[0][0].id).toBe("lot-a");
    });

    it("marks the selected lot with aria-selected=true", () => {
      const selectedLot: DisplayLot = {
        id: "lot-a",
        productId: "p-a",
        productName: "Acetaminofén 500mg",
        lotCode: "L24001",
        currentStock: 50,
        expirationDate: "2027-06-01",
        location: "A1",
      };

      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal, groupLowStock]}
          selectedLot={selectedLot}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Acetaminofén/ }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Ibuprofeno/ }),
      );

      const selectedOption = screen.getByRole("option", {
        name: /L24001/,
      });
      expect(selectedOption).toHaveAttribute("aria-selected", "true");

      const unselectedOption = screen.getByRole("option", {
        name: /L24002/,
      });
      expect(unselectedOption).toHaveAttribute("aria-selected", "false");
    });

    it("expands a group when Enter is pressed on a collapsed group header", () => {
      render(
        <LotSearchPanel
          {...defaultProps}
          productGroups={[groupNormal]}
        />,
      );

      const header = screen.getByRole("button", {
        name: /Acetaminofén/,
      });
      fireEvent.keyDown(header, { key: "Enter", code: "Enter" });

      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("option")).toBeInTheDocument();
    });
  });
});
