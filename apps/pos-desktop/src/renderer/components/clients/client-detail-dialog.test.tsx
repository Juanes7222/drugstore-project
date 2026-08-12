/**
 * Component tests for ClientDetailDialog.
 *
 * Covers: rendering nothing when closed, client identity (name, document,
 * email, phone), dashes for missing optional fields, active/inactive status
 * badges, the sales history section (items, empty, error, count), and the
 * edit hand-off / Esc-to-close interactions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockCreditService = vi.hoisted(() => ({
  getCreditState: vi.fn(),
  getCreditHistory: vi.fn(),
  recordCreditPayment: vi.fn(),
  annulCreditPayment: vi.fn(),
}));

vi.mock("../common/service-context", () => ({
  useSalesHistoryService: () => mockSalesHistoryService,
  useCreditService: () => mockCreditService,
}));

// The dialog reads the current session role to gate the ADMIN-only annul
// action. Default: no session (cashier). Individual tests override it.
const mockLocalSessionStore = vi.hoisted(() => ({
  useLocalSessionStore: vi.fn(),
}));

vi.mock("../../../domain/auth/local-session.store", () => mockLocalSessionStore);

function setSessionRole(role: string | null) {
  mockLocalSessionStore.useLocalSessionStore.mockImplementation(
    (selector: (s: { session: { role: string } | null }) => unknown) =>
      selector({ session: role ? { role } : null }),
  );
}

// The real picker loads methods via ServiceContext (unavailable here) — mock
// it to a fixed single-option select so the abono dialog can pick a method.
vi.mock("../common/payment-method-picker", () => ({
  PaymentMethodPicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (m: { id: string; name: string }) => void;
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) =>
        onChange({ id: e.target.value, name: "Efectivo" })
      }
    >
      <option value="pm-cash">Efectivo</option>
    </select>
  ),
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
    creditLimit: null,
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

const emptyCreditHistory = {
  items: [],
  debtCents: 0,
  creditEnabled: false,
};

beforeEach(() => {
  mockSalesHistoryService.listConfirmedSales.mockReset();
  mockCreditService.getCreditState.mockReset();
  mockCreditService.getCreditHistory.mockReset();
  mockCreditService.recordCreditPayment.mockReset();
  mockCreditService.annulCreditPayment.mockReset();
  setSessionRole(null);
  mockCreditService.getCreditState.mockResolvedValue({
    clientId: "client-1",
    creditLimitCents: 0,
    usedCents: 0,
    availableCents: 0,
    enabled: false,
  });
  mockCreditService.getCreditHistory.mockResolvedValue(emptyCreditHistory);
  mockCreditService.recordCreditPayment.mockResolvedValue({
    id: "abono-1",
    sequentialNumber: 1,
    clientId: "client-1",
    amountCents: 50000,
    paymentMethodId: "pm-cash",
    notes: null,
    createdAt: "2026-07-24T09:00:00.000Z",
    remainingDebtCents: 45000,
  });
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

  describe("credit history", () => {
    it("fetches and renders credit sales and returns with dates and amounts", async () => {
      mockCreditService.getCreditState.mockResolvedValue({
        clientId: "client-1",
        creditLimitCents: 1000000,
        usedCents: 95000,
        availableCents: 905000,
        enabled: true,
      });
      mockCreditService.getCreditHistory.mockResolvedValue({
        items: [
          {
            kind: "RETURN",
            id: "return-1",
            date: "2026-07-22T16:00:00.000Z",
            amountCents: 25000,
            reference: "D-000003",
            methodName: "Crédito",
          },
          {
            kind: "SALE",
            id: "sale-1",
            date: "2026-07-20T10:05:00.000Z",
            amountCents: 120000,
            reference: "#1042",
            methodName: "Crédito",
          },
        ],
        debtCents: 95000,
        creditEnabled: true,
      });

      setup(makeClient());

      expect(
        await screen.findByText("Historial de crédito"),
      ).toBeInTheDocument();
      expect(mockCreditService.getCreditHistory).toHaveBeenCalledWith(
        "client-1",
        10,
      );
      expect(await screen.findByText(/D-000003/)).toBeInTheDocument();
      expect(screen.getByText(/#1042/)).toBeInTheDocument();
      // es-CO formatting: 120000 cents → "$1.200,00"
      expect(screen.getByText(/\+\$1\.200/)).toBeInTheDocument();
      expect(screen.getByText(/−\$250/)).toBeInTheDocument();
      expect(screen.getByText("2 movimientos")).toBeInTheDocument();
    });

    it("renders the empty state when credit is enabled but there are no movements", async () => {
      mockCreditService.getCreditState.mockResolvedValue({
        clientId: "client-1",
        creditLimitCents: 1000000,
        usedCents: 0,
        availableCents: 1000000,
        enabled: true,
      });

      setup(makeClient());

      expect(
        await screen.findByText("Sin movimientos de crédito"),
      ).toBeInTheDocument();
    });

    it("hides the credit history section when credit is disabled", async () => {
      setup(makeClient());

      await screen.findByText("Crédito no habilitado");

      expect(
        screen.queryByText("Historial de crédito"),
      ).not.toBeInTheDocument();
      expect(mockCreditService.getCreditHistory).not.toHaveBeenCalled();
    });

    it("renders an error message when the credit history load fails", async () => {
      mockCreditService.getCreditState.mockResolvedValue({
        clientId: "client-1",
        creditLimitCents: 1000000,
        usedCents: 0,
        availableCents: 1000000,
        enabled: true,
      });
      mockCreditService.getCreditHistory.mockRejectedValue(new Error("boom"));

      setup(makeClient());

      expect(
        await screen.findByText("No se pudo cargar el historial de crédito"),
      ).toBeInTheDocument();
    });
  });

  describe("credit payments (abonos)", () => {
    function setupWithDebt(usedCents: number) {
      mockCreditService.getCreditState.mockResolvedValue({
        clientId: "client-1",
        creditLimitCents: 1000000,
        usedCents,
        availableCents: 1000000 - usedCents,
        enabled: true,
      });
      return setup(makeClient());
    }

    it("shows the Abono button only when the client has debt", async () => {
      setupWithDebt(95000);

      expect(
        await screen.findByRole("button", { name: "Abono" }),
      ).toBeInTheDocument();
    });

    it("hides the Abono button when the client has no debt", async () => {
      setupWithDebt(0);

      await screen.findByText("Crédito");

      expect(screen.queryByText("Registrar abono")).not.toBeInTheDocument();
    });

    it("records the abono with amount and payment method, then refreshes state and history", async () => {
      const user = userEvent.setup();
      setupWithDebt(95000);

      await user.click(
        await screen.findByRole("button", { name: "Abono" }),
      );
      expect(
        await screen.findByText("Monto del abono"),
      ).toBeInTheDocument();

      const before = mockCreditService.getCreditState.mock.calls.length;
      await user.type(
        screen.getByLabelText("Monto del abono"),
        "500",
      );
      await user.selectOptions(
        screen.getByLabelText("Método de pago"),
        "pm-cash",
      );
      await user.click(
        screen.getByRole("button", { name: "Registrar abono" }),
      );

      expect(mockCreditService.recordCreditPayment).toHaveBeenCalledWith({
        clientId: "client-1",
        amountCents: 50000,
        paymentMethodId: "pm-cash",
        notes: undefined,
      });
      // State + history are refetched after a successful abono.
      await waitFor(() => {
        expect(
          mockCreditService.getCreditState.mock.calls.length,
        ).toBeGreaterThan(before);
      });
    });

    it("blocks amounts above the current debt and shows the error", async () => {
      const user = userEvent.setup();
      setupWithDebt(95000);

      await user.click(
        await screen.findByRole("button", { name: "Abono" }),
      );
      await user.type(screen.getByLabelText("Monto del abono"), "2000");
      await user.selectOptions(
        screen.getByLabelText("Método de pago"),
        "pm-cash",
      );
      await user.click(
        screen.getByRole("button", { name: "Registrar abono" }),
      );

      expect(mockCreditService.recordCreditPayment).not.toHaveBeenCalled();
      expect(
        await screen.findByText(/no puede superar la deuda/),
      ).toBeInTheDocument();
    });
  });

  describe("credit payment annulment (ADMIN)", () => {
    function setupWithPaymentHistory(overrides: Record<string, unknown> = {}) {
      mockCreditService.getCreditState.mockResolvedValue({
        clientId: "client-1",
        creditLimitCents: 1000000,
        usedCents: 90000,
        availableCents: 910000,
        enabled: true,
      });
      mockCreditService.getCreditHistory.mockResolvedValue({
        items: [
          {
            kind: "PAYMENT",
            id: "abono-1",
            date: "2026-07-24T09:00:00.000Z",
            amountCents: 10000,
            reference: "AB-000001",
            methodName: "Efectivo",
            ...overrides,
          },
        ],
        debtCents: 90000,
        creditEnabled: true,
      });
      return setup(makeClient());
    }

    it("shows the annul button to ADMIN users on a payment entry", async () => {
      setSessionRole("ADMIN");
      setupWithPaymentHistory();

      expect(
        await screen.findByRole("button", { name: "Anular" }),
      ).toBeInTheDocument();
    });

    it("hides the annul button from cashiers", async () => {
      setSessionRole("CASHIER");
      setupWithPaymentHistory();

      await screen.findByText(/AB-000001/);

      expect(
        screen.queryByRole("button", { name: "Anular" }),
      ).not.toBeInTheDocument();
    });

    it("requires an annulment reason before submitting", async () => {
      const user = userEvent.setup();
      setSessionRole("ADMIN");
      setupWithPaymentHistory();

      await user.click(
        await screen.findByRole("button", { name: "Anular" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Confirmar anulación" }),
      );

      expect(mockCreditService.annulCreditPayment).not.toHaveBeenCalled();
      expect(
        screen.getByText("El motivo de anulación es obligatorio."),
      ).toBeInTheDocument();
    });

    it("annuls the payment with the reason and refreshes state and history", async () => {
      const user = userEvent.setup();
      setSessionRole("ADMIN");
      setupWithPaymentHistory();
      mockCreditService.annulCreditPayment.mockResolvedValue({
        id: "abono-1",
        sequentialNumber: 1,
        clientId: "client-1",
        annulledAt: "2026-07-25T11:00:00.000Z",
        remainingDebtCents: 100000,
      });

      await user.click(
        await screen.findByRole("button", { name: "Anular" }),
      );
      await user.type(
        screen.getByLabelText("Motivo de anulación"),
        "Registro duplicado",
      );

      const before = mockCreditService.getCreditState.mock.calls.length;
      await user.click(
        screen.getByRole("button", { name: "Confirmar anulación" }),
      );

      expect(mockCreditService.annulCreditPayment).toHaveBeenCalledWith(
        "abono-1",
        "Registro duplicado",
      );
      await waitFor(() => {
        expect(
          mockCreditService.getCreditState.mock.calls.length,
        ).toBeGreaterThan(before);
      });
    });

    it("shows the annulled badge instead of the annul button for annulled payments", async () => {
      setSessionRole("ADMIN");
      setupWithPaymentHistory({
        annulled: true,
        annulmentReason: "Registro duplicado",
      });

      expect(await screen.findByText("Anulado")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Anular" }),
      ).not.toBeInTheDocument();
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
