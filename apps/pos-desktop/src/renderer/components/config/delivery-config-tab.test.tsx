/**
 * Component tests for DeliveryConfigTab.
 *
 * Regression guard: the tab used to PUT `fixedDeliveryFeeCents: 0` while in
 * FIXED mode and the server rejected it — the tab now validates the would-be
 * delivery object locally (via `validateTenantConfig`) before PUTting.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_DELIVERY,
  DEFAULT_FISCAL,
  DEFAULT_PURCHASES,
  DEFAULT_STRICTNESS,
  DEFAULT_WORKFLOW,
} from "../../../domain/config/defaults";
import type { DeliveryConfig, TenantConfig } from "../../../domain/config/types";
import { DeliveryConfigTab } from "./delivery-config-tab";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const deliveryConfig = (
  overrides: Partial<DeliveryConfig> = {},
): DeliveryConfig => ({
  ...DEFAULT_DELIVERY,
  enabled: true,
  ...overrides,
});

const tenantConfig = (delivery: DeliveryConfig): TenantConfig => ({
  id: "tenant-1",
  subscriptionId: "sub-1",
  activePresetCode: null,
  strictness: DEFAULT_STRICTNESS,
  fiscal: DEFAULT_FISCAL,
  workflow: { ...DEFAULT_WORKFLOW, delivery },
  purchases: DEFAULT_PURCHASES,
  customCompanyFields: [],
  customStrictnessToggles: [],
  configVersion: 1,
  lastModifiedByUserId: "user-1",
  lastModifiedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
});

type FieldChange = (
  section: "fiscal" | "workflow",
  key: string,
  value: unknown,
) => Promise<void>;

const renderTab = (config: TenantConfig, readOnly = false) => {
  const onFieldChange = vi.fn<FieldChange>();
  render(
    <DeliveryConfigTab
      config={config}
      readOnly={readOnly}
      onFieldChange={onFieldChange}
    />,
  );
  return onFieldChange;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DeliveryConfigTab", () => {
  describe("fixed fee validation", () => {
    it("blocks the PUT and shows fixedFeeError when the fixed fee is emptied in FIXED mode", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(
        deliveryConfig({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 0 }),
      );
      const onFieldChange = renderTab(config);

      const feeInput = screen.getByRole("textbox", { name: "Tarifa fija" });
      await user.clear(feeInput);

      expect(onFieldChange).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Debe especificar una tarifa fija mayor a cero",
      );
      expect(feeInput).toHaveAttribute("aria-invalid", "true");
    });

    it("PUTs the converted cents once a valid fixed fee is typed and clears the error", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(
        deliveryConfig({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 0 }),
      );
      const onFieldChange = renderTab(config);

      const feeInput = screen.getByRole("textbox", { name: "Tarifa fija" });
      await user.clear(feeInput);

      // fireEvent.change: the MoneyField reformats its value on every
      // keystroke ("05" -> "5"), which derails userEvent's char-by-char
      // typing — a single change event with the full amount is reliable.
      fireEvent.change(feeInput, { target: { value: "5000" } });

      expect(onFieldChange).toHaveBeenLastCalledWith(
        "workflow",
        "delivery",
        expect.objectContaining({
          deliveryFeeMode: "FIXED",
          fixedDeliveryFeeCents: 500000,
        }),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(feeInput).toHaveAttribute("aria-invalid", "false");
    });
  });

  describe("manual max fee validation", () => {
    it("blocks the PUT when the max fee is set below the reference fixed fee", async () => {
      const config = tenantConfig(
        deliveryConfig({
          deliveryFeeMode: "MANUAL",
          fixedDeliveryFeeCents: 50000,
          maxDeliveryFeeCents: 0,
        }),
      );
      const onFieldChange = renderTab(config);

      // fireEvent.change: one event for "50" pesos (5000 cents). Typing
      // keystroke-by-keystroke would rewrite the formatted value mid-way
      // ("100" -> "10050") and end up above the fixed fee, so no error.
      fireEvent.change(
        screen.getByRole("textbox", { name: "Tarifa máxima" }),
        { target: { value: "50" } },
      );

      expect(onFieldChange).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El tope no puede ser menor a la tarifa fija de referencia",
      );
    });
  });

  describe("fee mode switching", () => {
    it("clears the stale fixed fee error when switching from FIXED to DISABLED", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(
        deliveryConfig({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 0 }),
      );
      const onFieldChange = renderTab(config);

      await user.clear(screen.getByRole("textbox", { name: "Tarifa fija" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: "Sin tarifa" }));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onFieldChange).toHaveBeenLastCalledWith(
        "workflow",
        "delivery",
        expect.objectContaining({ deliveryFeeMode: "DISABLED" }),
      );
    });
  });

  describe("master switch", () => {
    it("PUTs enabled: true when toggled on and hides the other sections while disabled", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(deliveryConfig({ enabled: false }));
      const onFieldChange = renderTab(config);

      expect(
        screen.queryByRole("switch", { name: "Cliente obligatorio" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(screen.queryByText("Tarifa de envío")).not.toBeInTheDocument();
      expect(screen.queryByText("Recibo")).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("switch", { name: "Habilitar domicilios" }),
      );

      expect(onFieldChange).toHaveBeenLastCalledWith(
        "workflow",
        "delivery",
        expect.objectContaining({ enabled: true }),
      );
    });

    it("PUTs enabled: false when toggled off", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(
        deliveryConfig({
          enabled: true,
          deliveryFeeMode: "FIXED",
          fixedDeliveryFeeCents: 1000,
        }),
      );
      const onFieldChange = renderTab(config);

      await user.click(
        screen.getByRole("switch", { name: "Habilitar domicilios" }),
      );

      expect(onFieldChange).toHaveBeenLastCalledWith(
        "workflow",
        "delivery",
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe("readOnly mode", () => {
    it("disables every control and never PUTs on interaction", async () => {
      const user = userEvent.setup();
      const config = tenantConfig(
        deliveryConfig({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 500000 }),
      );
      const onFieldChange = renderTab(config, true);

      expect(
        screen.getAllByRole("switch").every((s) => s.hasAttribute("disabled")),
      ).toBe(true);
      expect(
        screen.getAllByRole("radio").every((r) => r.hasAttribute("disabled")),
      ).toBe(true);
      expect(screen.getByRole("textbox", { name: "Tarifa fija" })).toBeDisabled();

      await user.click(
        screen.getByRole("switch", { name: "Habilitar domicilios" }),
      );
      await user.click(screen.getByRole("radio", { name: "Tarifa fija" }));

      expect(onFieldChange).not.toHaveBeenCalled();
    });
  });

  describe("fee field visibility per mode", () => {
    it("shows only the fixed fee field in FIXED mode", () => {
      renderTab(
        tenantConfig(
          deliveryConfig({ deliveryFeeMode: "FIXED", fixedDeliveryFeeCents: 1000 }),
        ),
      );

      expect(
        screen.getByRole("textbox", { name: "Tarifa fija" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "Tarifa máxima" }),
      ).not.toBeInTheDocument();
    });

    it("shows only the max fee field in MANUAL mode", () => {
      renderTab(tenantConfig(deliveryConfig({ deliveryFeeMode: "MANUAL" })));

      expect(
        screen.queryByRole("textbox", { name: "Tarifa fija" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: "Tarifa máxima" }),
      ).toBeInTheDocument();
    });

    it("hides both fee fields in DISABLED mode", () => {
      renderTab(tenantConfig(deliveryConfig({ deliveryFeeMode: "DISABLED" })));

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });
});
