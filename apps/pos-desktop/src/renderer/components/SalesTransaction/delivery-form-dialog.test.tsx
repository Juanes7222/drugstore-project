/**
 * Component tests for DeliveryFormDialog.
 *
 * Covers: policy-driven fields (address, phone, scheduling), the three fee
 * modes (FIXED / MANUAL / DISABLED), validation error mapping for the
 * delivery DomainError codes, and the saved draft shape.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_DELIVERY } from "../../../domain/config/defaults";
import type { DeliveryConfig } from "../../../domain/config/types";
import type {
  SaleDeliveryDraft,
  SelectedClient,
} from "@/store/slices/sales-types";
import { DeliveryFormDialog } from "./delivery-form-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const config = (overrides: Partial<DeliveryConfig> = {}): DeliveryConfig => ({
  ...DEFAULT_DELIVERY,
  enabled: true,
  ...overrides,
});

const deliveryDraft = (
  overrides: Partial<SaleDeliveryDraft> = {},
): SaleDeliveryDraft => ({
  state: "PENDING",
  address: "Calle 10 #20-30",
  contactName: "Ana Gómez",
  contactPhone: "5551234",
  notes: null,
  scheduledAt: null,
  feeCents: 5_000,
  ...overrides,
});

/** Client with no address/phone so prefill never masks a validation path. */
const clientWithoutAddress = (): SelectedClient => ({
  id: "client-1",
  name: "Ana Gómez",
  identification: "CC: 100200300",
  address: null,
  phone: null,
});

const renderDialog = (
  deliveryConfig: DeliveryConfig,
  options: {
    delivery?: SaleDeliveryDraft | null;
    client?: SelectedClient | null;
  } = {},
) => {
  const onSave = vi.fn();
  render(
    <DeliveryFormDialog
      open
      onOpenChange={vi.fn()}
      deliveryConfig={deliveryConfig}
      delivery={options.delivery ?? null}
      client={options.client ?? null}
      onSave={onSave}
    />,
  );
  return onSave;
};

const confirmButton = () =>
  screen.getByRole("button", { name: "Confirmar domicilio" });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DeliveryFormDialog", () => {
  it("shows the address field with a required marker when addressRequired is true", () => {
    renderDialog(config({ addressRequired: true }));

    expect(screen.getByLabelText(/Dirección/)).toHaveAttribute("required");
  });

  it("hides the address field when addressRequired is false", () => {
    renderDialog(config({ addressRequired: false }));

    expect(screen.queryByLabelText(/Dirección/)).not.toBeInTheDocument();
  });

  it("marks the phone field required when phoneRequired is true", () => {
    renderDialog(config({ phoneRequired: true }));

    expect(screen.getByLabelText(/Teléfono de contacto/)).toHaveAttribute(
      "required",
    );
  });

  it("leaves the phone field optional when phoneRequired is false", () => {
    renderDialog(config({ phoneRequired: false }));

    expect(screen.getByLabelText(/Teléfono de contacto/)).not.toHaveAttribute(
      "required",
    );
  });

  it("shows the scheduling input only when allowScheduling is true", () => {
    renderDialog(config({ allowScheduling: true }));

    expect(screen.getByLabelText("Programar entrega")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  it("omits the scheduling input when allowScheduling is false", () => {
    renderDialog(config({ allowScheduling: false }));

    expect(screen.queryByLabelText("Programar entrega")).not.toBeInTheDocument();
  });

  it("shows the fixed fee as a read-only amount when deliveryFeeMode is FIXED", () => {
    renderDialog(
      config({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 12_500 }),
    );

    // 12 500 cents = $ 125 — rendered as text, no editable fee input
    expect(screen.getByText(/\$\s*125/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Valor del domicilio/)).not.toBeInTheDocument();
  });

  it("shows an editable fee with a max hint when deliveryFeeMode is MANUAL with a cap", () => {
    renderDialog(config({ deliveryFeeMode: "MANUAL", maxDeliveryFeeCents: 50_000 }));

    expect(screen.getByLabelText(/Valor del domicilio/)).toBeInTheDocument();
    // 50 000 cents = $ 500
    expect(screen.getByText(/Máximo \$\s*500/)).toBeInTheDocument();
  });

  it("shows no fee field when deliveryFeeMode is DISABLED", () => {
    renderDialog(config({ deliveryFeeMode: "DISABLED" }));

    expect(screen.queryByLabelText(/Valor del domicilio/)).not.toBeInTheDocument();
    // Only the dialog title uses the "Domicilio" label
    expect(screen.getAllByText("Domicilio")).toHaveLength(1);
  });

  it("shows the client-required error when a client is required but none is selected", () => {
    const onSave = renderDialog(config({ requiresClient: true }), {
      client: null,
    });

    fireEvent.click(confirmButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Seleccione un cliente antes de confirmar el domicilio.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the address-required error when the address is empty", () => {
    const onSave = renderDialog(config({ addressRequired: true }), {
      client: clientWithoutAddress(),
    });

    fireEvent.click(confirmButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "La dirección de entrega es obligatoria.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the phone-required error when the phone is empty", () => {
    const onSave = renderDialog(config({ phoneRequired: true }), {
      client: clientWithoutAddress(),
    });
    fireEvent.change(screen.getByLabelText(/Dirección/), {
      target: { value: "Calle 10 #20-30" },
    });

    fireEvent.click(confirmButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El teléfono de contacto es obligatorio.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the fee-policy error when the manual fee exceeds the cap", () => {
    const onSave = renderDialog(
      config({
        addressRequired: false,
        deliveryFeeMode: "MANUAL",
        maxDeliveryFeeCents: 50_000,
      }),
      { client: null },
    );
    // 600 pesos = 60 000 cents > 50 000 cents cap
    fireEvent.change(screen.getByLabelText(/Valor del domicilio/), {
      target: { value: "600" },
    });

    fireEvent.click(confirmButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no puede superar \$\s*500\./,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a manual fee that is within the cap", () => {
    const onSave = renderDialog(
      config({
        addressRequired: false,
        deliveryFeeMode: "MANUAL",
        maxDeliveryFeeCents: 50_000,
      }),
      { client: null },
    );
    fireEvent.change(screen.getByLabelText(/Valor del domicilio/), {
      target: { value: "400" },
    });

    fireEvent.click(confirmButton());

    // 400 pesos = 40 000 cents
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ state: "PENDING", feeCents: 40_000 }),
    );
  });

  it("saves the draft with trimmed values and the resolved fixed fee", () => {
    const onSave = renderDialog(
      config({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 12_500 }),
      { client: null },
    );
    fireEvent.change(screen.getByLabelText(/Dirección/), {
      target: { value: "  Calle 10 #20-30  " },
    });
    fireEvent.change(screen.getByLabelText(/Nombre de contacto/), {
      target: { value: " Ana Gómez " },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono de contacto/), {
      target: { value: " 5551234 " },
    });
    fireEvent.change(screen.getByLabelText(/Notas/), {
      target: { value: " Entregar antes de las 6pm " },
    });

    fireEvent.click(confirmButton());

    expect(onSave).toHaveBeenCalledWith({
      state: "PENDING",
      address: "Calle 10 #20-30",
      contactName: "Ana Gómez",
      contactPhone: "5551234",
      notes: "Entregar antes de las 6pm",
      scheduledAt: null,
      feeCents: 12_500,
    });
  });

  it("saves the scheduledAt as an ISO string when scheduling is allowed", () => {
    const onSave = renderDialog(
      config({ addressRequired: false, allowScheduling: true }),
      { client: null },
    );
    fireEvent.change(screen.getByLabelText("Programar entrega"), {
      target: { value: "2026-08-10T15:30" },
    });

    fireEvent.click(confirmButton());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: expect.any(String) }),
    );
  });

  it("prefills the form from the existing draft when editing", () => {
    renderDialog(config({ addressRequired: true, deliveryFeeMode: "MANUAL" }), {
      delivery: deliveryDraft({ address: "Calle 10 #20-30", feeCents: 40_000 }),
    });

    expect(screen.getByLabelText(/Dirección/)).toHaveValue("Calle 10 #20-30");
    // 40 000 cents displayed as 400 pesos
    expect(screen.getByLabelText(/Valor del domicilio/)).toHaveValue(400);
  });
});