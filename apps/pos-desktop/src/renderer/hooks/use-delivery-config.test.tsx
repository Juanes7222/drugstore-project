/**
 * Unit tests for useDeliveryConfig.
 *
 * Covers: the disabled-feature fallback while the tenant config has not
 * landed, the effective workflow.delivery once it does, and the fallback
 * again after the config is cleared.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTenantConfigStore } from "../../domain/config/tenant-config.store";
import {
  DEFAULT_DELIVERY,
  DEFAULT_FISCAL,
  DEFAULT_PURCHASES,
  DEFAULT_STRICTNESS,
  DEFAULT_WORKFLOW,
} from "../../domain/config/defaults";
import type { DeliveryConfig, EffectiveConfig } from "../../domain/config/types";
import { useDeliveryConfig } from "./use-delivery-config";

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useDeliveryConfig", () => {
  beforeEach(() => {
    useTenantConfigStore.getState().clearConfig();
  });

  it("returns DEFAULT_DELIVERY while the tenant config has not landed", () => {
    const { result } = renderHook(() => useDeliveryConfig());

    expect(result.current).toBe(DEFAULT_DELIVERY);
  });

  it("returns the effective workflow.delivery once the config is set", () => {
    const delivery = deliveryConfig({
      deliveryFeeMode: "FIXED",
      fixedDeliveryFeeCents: 12_500,
    });
    act(() => applyConfig(delivery));

    const { result } = renderHook(() => useDeliveryConfig());

    expect(result.current).toBe(delivery);
  });

  it("falls back to DEFAULT_DELIVERY when the config is cleared", () => {
    act(() => applyConfig(deliveryConfig()));
    act(() => useTenantConfigStore.getState().clearConfig());

    const { result } = renderHook(() => useDeliveryConfig());

    expect(result.current).toBe(DEFAULT_DELIVERY);
  });
});