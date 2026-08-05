/**
 * Component tests for ClientDetailDialog.
 *
 * Covers: rendering nothing when closed, client identity (name, document,
 * email, phone), dashes for missing optional fields, active/inactive status
 * badges, the sales history section (items, empty, error, count), and the
 * edit hand-off / Esc-to-close interactions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientDetailDialog } from "./client-detail-dialog";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";
import type { SaleHistoryListItem } from "../../../domain/sales-pos/sales-history.service";

// i18n singleton initialized via vitest.setup.ts (Spanish by default)

// ---------------------------------------------------------------------------
// Mocks — the dialog loads sales history from the sales-history service
// ---------------------------------------------------------------------------

// The service instance must keep a stable identity across renders (like the
// real context does), otherwise the dialog's effect would re-run every render.
const mockSalesHistoryService = vi.hoisted(() => ({
  listConfirmedSales: vi.fn(),
}));

vi.mock("../common/service-context", () => ({
  useSalesHistoryService: () => mockSalesHistoryService,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<ClientSearchResult> = {}): ClientSearchResult {
  return {
    id: "client-1",
    fullName: "María Gómez",
    identificationType: "CC",
    identificationNumber: "1023456789",
    email: "maria@example.com",
    phone: "3001234567",
    address: "Calle 12 #34-56",
    municipality: "Bogotá",
    department: "Cundinamarca",
    isActive: true,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    ...overrides,
  };
}

function makeSale(overrides: Partial<SaleHistoryListItem> = {}): SaleHistoryListItem {
  return {
    saleId: "sale-1",
    localNumber: "1042",
    confirmedAt: "2026-07-22T18:30:00.000Z",
    totalAmount: "45600",
    clientName: "María Gómez",
    clientIdentificationNumber: "1023456789",
    invoiceId: "inv-1",
    invoiceNumber: "FE-0042",
    invoiceStatus: "TRANSMITTED_AUTHORIZED",
    invoiceType: "ELECTRONIC_INVOICE",
    hasAdjustments: false,
    deliveryFeeCents: 0,
    deliveryAddress: null,
    ...overrides,
  };
}

function setup(
  client: ClientSearchResult | null,
  salesResult: { items: SaleHistoryListItem[]; total: number } = { items: [], total: 0 },
  rejectWith?: Error,
) {
  if (rejectWith) {
    mockSalesHistoryService.listConfirmedSales.mockRejectedValue(rejectWith);
  } else {
    mockSalesHistoryService.listConfirmedSales.mockResolvedValue(salesResult);
  }
  const onClose = vi.fn();
  const onEdit = vi.fn();
  render(<ClientDetailDialog client={client} onClose={onClose} onEdit={onEdit} />);
  return { onClose, onEdit };
}

beforeEach(() => {
  mockSalesHistoryService.listConfirmedSales.mockReset();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ClientDetailDialog", () => {
  describe("open state", () => {
    it("renders nothing and does not fetch sales when client is null", () => {
      setup(null);

      expect(screen.queryByText("María Gómez")).not.toBeInTheDocument();
      expect(mockSalesHistoryService.listConfirmedSales).not.toHaveBeenCalled();
    });

    it("renders the client identity when open", () => {
      setup(makeClient());

      // Modal eyebrow heading + identity
      expect(screen.getByText("Detalles del cliente")).toBeInTheDocument();
      expect(screen.getByText("María Gómez")).toBeInTheDocument();
      expect(screen.getByText("CC")).toBeInTheDocument();
      expect(screen.getByText("1023456789")).toBeInTheDocument();
      expect(screen.getByText("maria@example.com")).toBeInTheDocument();
      expect(screen.getByText("3001234567")).toBeInTheDocument();
      expect(screen.getByText("Calle 12 #34-56")).toBeInTheDocument();
      expect(screen.getByText("Bogotá, Cundinamarca")).toBeInTheDocument();
    });
  });

  describe("optional fields", () => {
    it("renders dashes for missing optional fields", () => {
      setup(
        makeClient({
          email: null,
          phone: null,
          address: null,
          municipality: null,
          department: null,
        }),
      );

      // Email, phone, address, and city all fall back to a dash.
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("status badge", () => {
    it("shows the active badge for an active client", () => {
      setup(makeClient({ isActive: true }));

      expect(screen.getByText("Activo")).toBeInTheDocument();
      expect(screen.queryByText("Inactivo")).not.toBeInTheDocument();
    });

    it("shows the inactive badge for an inactive client", () => {
      setup(makeClient({ isActive: false }));

      expect(screen.getByText("Inactivo")).toBeInTheDocument();
      expect(screen.queryByText("Activo")).not.toBeInTheDocument();
    });
  });

  describe("sales history", () => {
    it("fetches and renders the client's recent sales with totals and count", async () => {
      setup(
        makeClient(),
        {
          items: [makeSale()],
          total: 2,
        },
      );

      expect(mockSalesHistoryService.listConfirmedSales).toHaveBeenCalledWith({
        clientId: "client-1",
        limit: 5,
      });
      expect(await screen.findByText("#1042")).toBeInTheDocument();
      expect(screen.getByText("FE-0042")).toBeInTheDocument();
      // es-CO formatting of 45600 → "$45.600,00"
      expect(screen.getByText(/\$45\.600/)).toBeInTheDocument();
      // Pluralized count from the full total
      expect(screen.getByText("2 ventas")).toBeInTheDocument();
    });

    it("renders the empty state when the client has no sales", async () => {
      setup(makeClient(), { items: [], total: 0 });

      expect(
        await screen.findByText("Sin ventas registradas"),
      ).toBeInTheDocument();
    });

    it("renders an error message when loading fails", async () => {
      setup(makeClient(), undefined, new Error("boom"));

      expect(
        await screen.findByText("No se pudo cargar el historial de ventas"),
      ).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("calls onEdit with the client when the edit button is clicked", async () => {
      const user = userEvent.setup();
      const client = makeClient();
      const { onEdit } = setup(client);

      await user.click(screen.getByRole("button", { name: "Editar" }));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith(client);
    });

    it("calls onClose when Escape is pressed", async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeClient());

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when the X button is clicked", async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeClient());

      await user.click(screen.getAllByRole("button", { name: "Cerrar" })[0]);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
