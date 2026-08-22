/**
 * Component tests for DeliveryToggle.
 *
 * Covers: hidden while the tenant delivery policy is off, the enable
 * switch (disabled with a hint when a client is required but missing), the
 * summary card, and the setDelivery dispatch on save/remove.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice, setDelivery } from "@/store/slices/sales-slice";
import { useTenantConfigStore } from "../../../domain/config/tenant-config.store";
import {
  DEFAULT_DELIVERY,
  DEFAULT_FISCAL,
  DEFAULT_PURCHASES,
  DEFAULT_STRICTNESS,
  DEFAULT_WORKFLOW,
} from "../../../domain/config/defaults";
import type {
  EffectiveConfig,
  DeliveryConfig,
} from "../../../domain/config/types";
import type {
  SaleDeliveryDraft,
  SelectedClient,
} from "@/store/slices/sales-types";
import { DeliveryToggle } from "./delivery-toggle";

// The real form dialog is covered by delivery-form-dialog.test.tsx; here it
// is replaced with a stub that triggers onSave so the toggle's dispatch
// wiring is tested in isolation.
vi.mock("./delivery-form-dialog", () => ({
  DeliveryFormDialog: (props: {
    open: boolean;
    onSave: (draft: SaleDeliveryDraft) => void;
  }) => {
    if (!props.open) return null;
    return (
      <button
        type="button"
        onClick={() =>
          props.onSave({
            state: "PENDING",
            address: "Calle 10 #20-30",
            contactName: null,
            contactPhone: null,
            notes: null,
            scheduledAt: null,
            feeCents: 5_000,
          })
        }
      >
        mock-save
      </button>
    );
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deliveryConfig = (
  overrides: Partial<DeliveryConfig> = {},
): DeliveryConfig => ({
  ...DEFAULT_DELIVERY,
  enabled: true,
  ...overrides,
});

const deliveryDraft = (
  overrides: Partial<SaleDeliveryDraft> = {},
): SaleDeliveryDraft => ({
  state: "PENDING",
  address: "Calle 10 #20-30",
  contactName: null,
  contactPhone: null,
  notes: null,
  scheduledAt: null,
  feeCents: 5_000,
  ...overrides,
});

const applyConfig = (delivery: DeliveryConfig): void => {
  useTenantConfigStore.setState({
    effectiveConfig: {
      strictness: DEFAULT_STRICTNESS,
      fiscal: DEFAULT_FISCAL,
      workflow: { ...DEFAULT_WORKFLOW, delivery },
      purchases: DEFAULT_PURCHASES,
      customCompanyFields: [],
      customStrictnessToggles: [],
      activePresetCode: null,
      configVersion: 1,
    } satisfies EffectiveConfig,
  });
};

const createStore = (
  delivery: SaleDeliveryDraft | null,
  selectedClient: SelectedClient | null = null,
) =>
  configureStore({
    reducer: { sales: salesSlice.reducer },
    preloadedState: {
      sales: {
        items: [],
        selectedClient,
        delivery,
        selectedLineId: null,
        undoStack: [],
      },
    },
  });

const renderToggle = (store: ReturnType<typeof createStore>) =>
  render(
    <Provider store={store}>
      <DeliveryToggle />
    </Provider>,
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DeliveryToggle", () => {
  beforeEach(() => {
    useTenantConfigStore.getState().clearConfig();
  });

  it("renders nothing when the tenant delivery policy is disabled", () => {
    const store = createStore(null);
    const { container } = renderToggle(store);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an unchecked switch when enabled and no draft is set", () => {
    applyConfig(deliveryConfig());
    const store = createStore(null);
    renderToggle(store);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAccessibleName("Domicilio");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).not.toBeDisabled();
  });

  it("disables the switch and shows a hint when a client is required but none is selected", () => {
    applyConfig(deliveryConfig({ requiresClient: true }));
    const store = createStore(null);
    renderToggle(store);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription(
      "Seleccione un cliente para activar el domicilio",
    );
    expect(
      screen.getByText("Seleccione un cliente para activar el domicilio"),
    ).toBeVisible();
  });

  it("enables the switch once a client is selected", () => {
    applyConfig(deliveryConfig({ requiresClient: true }));
    const store = createStore(null, {
      id: "c-001",
      name: "Juan Pérez",
      identification: "CC-123456789",
    });
    renderToggle(store);

    expect(screen.getByRole("switch")).not.toBeDisabled();
    expect(
      screen.queryByText("Seleccione un cliente para activar el domicilio"),
    ).not.toBeInTheDocument();
  });

  it("shows the address and the fee in the summary card once a draft is set", () => {
    applyConfig(deliveryConfig());
    const store = createStore(deliveryDraft());
    renderToggle(store);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("Calle 10 #20-30")).toBeInTheDocument();
    // 5 000 cents = $ 50
    expect(screen.getByText(/\$\s*50$/)).toBeInTheDocument();
  });

  it("shows the scheduled time when the draft has no fee", () => {
    applyConfig(deliveryConfig());
    const store = createStore(
      deliveryDraft({ scheduledAt: "2026-08-10T15:30:00.000Z", feeCents: 0 }),
    );
    renderToggle(store);

    expect(screen.getByText("Calle 10 #20-30")).toBeInTheDocument();
    expect(screen.queryByText(/\$\s*50$/)).not.toBeInTheDocument();
    // es short date: "10/8/26, 10:30" — the day may shift by timezone,
    // but the 2-digit year is stable.
    expect(screen.getByText(/\d{1,2}\/\d{1,2}\/26/)).toBeInTheDocument();
  });

  it("dispatches setDelivery(draft) when a new draft is saved in the form", () => {
    applyConfig(deliveryConfig());
    const store = createStore(null);
    const dispatch = vi.spyOn(store, "dispatch");
    renderToggle(store);

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "mock-save" }));

    expect(dispatch).toHaveBeenCalledWith(
      setDelivery({
        state: "PENDING",
        address: "Calle 10 #20-30",
        contactName: null,
        contactPhone: null,
        notes: null,
        scheduledAt: null,
        feeCents: 5_000,
      }),
    );
  });

  it("opens the form prefilled with the draft when edit is clicked", () => {
    applyConfig(deliveryConfig());
    const store = createStore(deliveryDraft());
    renderToggle(store);

    fireEvent.click(screen.getByRole("button", { name: "Editar domicilio" }));

    expect(
      screen.getByRole("button", { name: "mock-save" }),
    ).toBeInTheDocument();
  });

  it("dispatches setDelivery(null) when remove is clicked and resets the draft", () => {
    applyConfig(deliveryConfig());
    const store = createStore(deliveryDraft());
    const dispatch = vi.spyOn(store, "dispatch");
    renderToggle(store);

    fireEvent.click(screen.getByRole("button", { name: "Quitar domicilio" }));

    expect(dispatch).toHaveBeenCalledWith(setDelivery(null));
    expect(store.getState().sales.delivery).toBeNull();
  });
});
