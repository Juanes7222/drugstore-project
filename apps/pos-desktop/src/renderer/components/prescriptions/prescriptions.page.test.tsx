/**
 * Component tests for PrescriptionsPage.
 *
 * Covers: form field rendering, controlled substance fields, validation,
 * submission, multi-item flow, and the no-pending state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { uiSlice } from "@/store/slices/ui-slice";
import { salesSlice, addItem } from "@/store/slices/sales-slice";
import { PrescriptionsPage } from "./prescriptions.page";
import type { CartItem } from "@/store/slices/sales-types";
import { SaleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("../common/service-context", () => ({
  usePrescriptionsService: () => ({
    create: mockCreate,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseCartItem: CartItem = {
  id: "item-1",
  productId: "p-001",
  name: "Acetaminofén 500mg",
  genericName: "Paracetamol",
  invimaCertificate: "INVIMA-TEST",
  saleType: SaleType.FREE_SALE,
  requiresPrescription: true,
  isRestricted: false,
  lotCode: "L24001",
  lotExpirationDate: "2027-06-01",
  unitPriceCents: 6_200,
  taxPercentage: 19,
  quantity: 2,
};

const createTestStore = (
  pendingItemId: string | null,
  incompleteItemIds: string[],
  items: CartItem[] = [baseCartItem],
) =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      sales: { items },
      ui: {
        activeScreen: "prescriptions" as const,
        saleCompletionPhase: "idle" as const,
        currentSaleId: null,
        pendingPurchaseOrderId: null,
        prescriptionFlow: {
          pendingSaleId: "sale-1",
          pendingItemId,
          incompleteItemIds,
        },
      },
    },
  });

const renderPage = (store = createTestStore("item-1", ["item-1"])) =>
  render(
    <Provider store={store}>
      <PrescriptionsPage />
    </Provider>,
  );

describe("PrescriptionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
  });

  describe("PRXP-01: form with basic fields", () => {
    it("renders the physician name field", () => {
      renderPage();

      expect(
        screen.getByLabelText(/Nombre completo del médico/i),
      ).toBeInTheDocument();
    });

    it("renders the license number field", () => {
      renderPage();

      expect(
        screen.getByLabelText(/Número de licencia médica/i),
      ).toBeInTheDocument();
    });

    it("renders the prescription date field", () => {
      renderPage();

      expect(
        screen.getByLabelText(/Fecha de prescripción/i),
      ).toBeInTheDocument();
    });

    it("renders the patient ID field", () => {
      renderPage();

      expect(
        screen.getByLabelText(/Número de identificación del paciente/i),
      ).toBeInTheDocument();
    });

    it("renders the item info showing the product name", () => {
      renderPage();

      expect(
        screen.getByText("Acetaminofén 500mg"),
      ).toBeInTheDocument();
    });

    it("renders a submit and a cancel button", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: /Guardar y continuar al pago/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Cancelar/i }),
      ).toBeInTheDocument();
    });
  });

  describe("PRXP-02: controlled substance fields", () => {
    it("shows the controlled substance checkbox", () => {
      renderPage();

      expect(
        screen.getByLabelText(/Sustancia controlada/i),
      ).toBeInTheDocument();
    });

    it("shows book entry and page fields when checked", async () => {
      renderPage();

      const checkbox = screen.getByLabelText(/Sustancia controlada/i);
      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(
          screen.getByLabelText(/Folio del libro/i),
        ).toBeInTheDocument();
        expect(
          screen.getByLabelText(/Página del libro/i),
        ).toBeInTheDocument();
      });
    });

    it("hides book fields when unchecked", () => {
      renderPage();

      expect(screen.queryByLabelText(/Folio del libro/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Página del libro/i)).not.toBeInTheDocument();
    });
  });

  describe("PRXP-03: validation", () => {
    it("shows an error when physician name is empty and submit is clicked", async () => {
      renderPage();

      const submitButton = screen.getByRole("button", { name: /Guardar y continuar al pago/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/médico es obligatorio/i),
        ).toBeInTheDocument();
      });
    });

    it("shows an error when license number is empty", async () => {
      renderPage();

      // Fill physician name
      const physicianInput = screen.getByLabelText(/Nombre completo del médico/i);
      await userEvent.type(physicianInput, "Dr. Pérez");

      const submitButton = screen.getByRole("button", { name: /Guardar y continuar al pago/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/licencia médica es obligatorio/i),
        ).toBeInTheDocument();
      });
    });

    it("shows controlled substance validation errors", async () => {
      renderPage();

      // Fill required fields
      const physicianInput = screen.getByLabelText(/Nombre completo del médico/i);
      await userEvent.type(physicianInput, "Dr. Pérez");
      const licenseInput = screen.getByLabelText(/Número de licencia médica/i);
      await userEvent.type(licenseInput, "LIC-12345");
      const patientInput = screen.getByLabelText(/Número de identificación del paciente/i);
      await userEvent.type(patientInput, "CC-123456");

      // Check controlled substance
      fireEvent.click(screen.getByLabelText(/Sustancia controlada/i));

      // Submit without book entry and page
      const submitButton = screen.getByRole("button", { name: /Guardar y continuar al pago/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/folio del libro es obligatorio/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("PRXP-04: successful registration", () => {
    it("calls prescriptionsService.create with the form data", async () => {
      renderPage();

      const physicianInput = screen.getByLabelText(/Nombre completo del médico/i);
      await userEvent.type(physicianInput, "Dr. Pérez");
      const licenseInput = screen.getByLabelText(/Número de licencia médica/i);
      await userEvent.type(licenseInput, "LIC-12345");
      const patientInput = screen.getByLabelText(/Número de identificación del paciente/i);
      await userEvent.type(patientInput, "CC-123456");

      const submitButton = screen.getByRole("button", { name: /Guardar y continuar al pago/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            saleItemId: "item-1",
            prescriberName: "Dr. Pérez",
            prescriptionNumber: "LIC-12345",
            patientIdNumber: "CC-123456",
            isControlledSubstance: false,
          }),
        );
      });
    });

    it("shows a success toast after registration", async () => {
      renderPage();

      const physicianInput = screen.getByLabelText(/Nombre completo del médico/i);
      await userEvent.type(physicianInput, "Dr. Pérez");
      const licenseInput = screen.getByLabelText(/Número de licencia médica/i);
      await userEvent.type(licenseInput, "LIC-12345");
      const patientInput = screen.getByLabelText(/Número de identificación del paciente/i);
      await userEvent.type(patientInput, "CC-123456");

      const submitButton = screen.getByRole("button", { name: /Guardar y continuar al pago/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
    });
  });

  describe("PRXP-05: multi-item flow", () => {
    it("shows 'next' button label when there are remaining items", () => {
      const store = createTestStore("item-1", ["item-1", "item-2"], [
        baseCartItem,
        { ...baseCartItem, id: "item-2", name: "Ibuprofeno 400mg" },
      ]);
      renderPage(store);

      expect(
        screen.getByRole("button", { name: /Guardar y siguiente/i }),
      ).toBeInTheDocument();
    });

    it("dispatches resolveNextPrescriptionItem after dismissing toast for non-last item", async () => {
      const store = createTestStore("item-1", ["item-1", "item-2"], [
        baseCartItem,
        { ...baseCartItem, id: "item-2", name: "Ibuprofeno 400mg" },
      ]);
      const dispatch = vi.spyOn(store, "dispatch");
      renderPage(store);

      // Fill required fields and submit
      const physicianInput = screen.getByLabelText(/Nombre completo del médico/i);
      await userEvent.type(physicianInput, "Dr. Pérez");
      const licenseInput = screen.getByLabelText(/Número de licencia médica/i);
      await userEvent.type(licenseInput, "LIC-12345");
      const patientInput = screen.getByLabelText(/Número de identificación del paciente/i);
      await userEvent.type(patientInput, "CC-123456");

      const submitButton = screen.getByRole("button", { name: /Guardar y siguiente/i });
      fireEvent.click(submitButton);

      // Wait for toast and dismiss it
      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      // Dismiss the toast by clicking close
      const closeButton = screen.getByRole("button", { name: /cerrar/i });
      fireEvent.click(closeButton);

      // After the 200ms exit animation, resolveNextPrescriptionItem should be dispatched
      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ type: "ui/resolveNextPrescriptionItem" }),
        );
      });
    });
  });

  describe("no pending state", () => {
    it("shows the no-pending message when pendingItemId is null", () => {
      const store = createTestStore(null, []);
      renderPage(store);

      expect(
        screen.getByText(/No hay requisitos de prescripción pendientes/i),
      ).toBeInTheDocument();
    });

    it("shows the no-pending message when cart item is not found", () => {
      // pendingItemId doesn't match any cart item
      const store = createTestStore("nonexistent", ["nonexistent"], []);
      renderPage(store);

      expect(
        screen.getByText(/No hay requisitos de prescripción pendientes/i),
      ).toBeInTheDocument();
    });
  });

  it("renders a header with items left when multiple items remain", () => {
    const store = createTestStore("item-1", ["item-1", "item-2"], [
      baseCartItem,
      { ...baseCartItem, id: "item-2", name: "Ibuprofeno 400mg" },
    ]);
    renderPage(store);

    expect(screen.getByText(/items restantes/i)).toBeInTheDocument();
  });

  it("does not show items left count when only one item remains", () => {
    renderPage();

    expect(screen.queryByText(/items restantes/i)).not.toBeInTheDocument();
  });

  it("renders with an accessible region aria-label", () => {
    renderPage();

    expect(
      screen.getByRole("region", { name: /Adjuntar prescripción/i }),
    ).toBeInTheDocument();
  });
});
