/**
 * Component tests for the sales-settings persistence contract.
 *
 * The tab used to mutate `useLocalConfigStore` and stop there. Those blocks were
 * workstation-local, so a discount limit set here reached no other machine and
 * was silently reverted by the next sync pull — the boot pulls the very same
 * `POS_DISCOUNT_LIMITS` / `POS_SALES_CONFIG` keys the tab never wrote.
 *
 * It now pushes to `PUT /configuration/pos-settings/sales`. The behaviour worth
 * pinning is the failure path: a rejected write must put the server's value back
 * on screen. Leaving the failed value visible is the same class of lie as before
 * — a setting that looks saved, is stored nowhere, and reverts on the next boot.
 *
 * NOTE on the fake-timer setup: the tab debounces its push, so the clock is
 * faked and advanced explicitly. `fireEvent.change` is used rather than
 * `userEvent` for the same reason — user-event drives its keystroke delays
 * through `setTimeout`, which never resolve under fake timers here and hang the
 * test. `fireEvent.change` sets the value through React's own change plumbing,
 * so the controlled input and the `onChange` agree, with no clock involved.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

const updateSalesSettings = vi.fn();
const notifyError = vi.fn();
const applyDefaultCreditToClients = vi.fn();

vi.mock("../../../domain/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../domain/config")>();
  return {
    ...actual,
    useConfigService: () => ({ updateSalesSettings }),
  };
});

vi.mock("@/utils/notify", () => ({
  notify: {
    error: (...args: unknown[]) => notifyError(...args),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    action: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/components/common/service-context", () => ({
  useClientsService: () => ({ applyDefaultCreditToClients }),
}));

import { SalesConfigTab } from "./sales-config-tab";
import { useLocalConfigStore } from "../../../domain/configuration/local-config.store";

/**
 * Pristine copy of the store, captured before any test mutates it.
 *
 * The `DEFAULT_*` blocks the store is built from are module-private, and
 * re-deriving them here would duplicate the defaults and drift from them.
 */
const pristine = structuredClone({
  discountLimits: useLocalConfigStore.getState().discountLimits,
  salesConfig: useLocalConfigStore.getState().salesConfig,
});

/** Longer than the tab's push debounce, so firing it settles any pending write. */
const PAST_DEBOUNCE_MS = 1_000;

/** Fire the debounced push and let the resulting promise settle. */
const settlePush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
  });
};

/**
 * The cashier's per-product limit field.
 *
 * Addressed by id, not by label: all four editable roles render the same
 * "Máx. por producto" label, so a label lookup is ambiguous.
 */
function cashierItemLimit(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    "#discount-cashier-item",
  )!;
}

describe("SalesConfigTab persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateSalesSettings.mockReset().mockResolvedValue(undefined);
    notifyError.mockReset();
    applyDefaultCreditToClients.mockReset().mockResolvedValue(undefined);
    useLocalConfigStore.setState(structuredClone(pristine));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes both blocks to the server when a limit changes", async () => {
        const { container } = render(<SalesConfigTab />);

    fireEvent.change(cashierItemLimit(container), { target: { value: "7" } });
    await settlePush();

    expect(updateSalesSettings).toHaveBeenCalledTimes(1);
    const payload = updateSalesSettings.mock.calls[0][0];
    expect(payload.discountLimits.cashier.itemMaxPercent).toBe(7);
    // The whole block travels, not just the edited role: the server stores it
    // as one object and a partial payload would blank every other role.
    expect(payload.discountLimits.owner.itemMaxPercent).toBe(
      pristine.discountLimits.owner.itemMaxPercent,
    );
    expect(payload.salesConfig).toEqual(pristine.salesConfig);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("restores the server's value and reports the error when the push is rejected", async () => {
    const original = pristine.discountLimits.cashier.itemMaxPercent;
    updateSalesSettings.mockRejectedValue(new Error("403 Forbidden"));

        const { container } = render(<SalesConfigTab />);

    fireEvent.change(cashierItemLimit(container), { target: { value: "7" } });
    await settlePush();

    // The edit really was applied and then undone: the payload the rejected push
    // carried proves the optimistic write happened, so asserting only the final
    // value would pass just as well if the input had never changed at all.
    expect(updateSalesSettings).toHaveBeenCalledTimes(1);
    expect(
      updateSalesSettings.mock.calls[0][0].discountLimits.cashier.itemMaxPercent,
    ).toBe(7);

    // Reverted, and the user was told. A value left on screen here would be a
    // setting that exists on no machine and vanishes at the next boot.
    expect(useLocalConfigStore.getState().discountLimits.cashier.itemMaxPercent).toBe(
      original,
    );
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("pushes the credit toggle", async () => {
        const { container } = render(<SalesConfigTab />);

    const toggle = container.querySelector<HTMLButtonElement>(
      "#credit-enabled",
    );
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);
    await settlePush();

    expect(updateSalesSettings).toHaveBeenCalledTimes(1);
    expect(updateSalesSettings.mock.calls[0][0].salesConfig.creditEnabled).toBe(
      true,
    );
  });

  it("flushes a pending push when the tab unmounts before the debounce elapses", async () => {
    // Clicking another settings tab unmounts this one within the debounce
    // window. Cancelling there would drop the edit with nothing to show for it.
        const { container, unmount } = render(<SalesConfigTab />);

    fireEvent.change(cashierItemLimit(container), { target: { value: "7" } });

    unmount();
    await settlePush();

    expect(updateSalesSettings).toHaveBeenCalledTimes(1);
    expect(
      updateSalesSettings.mock.calls[0][0].discountLimits.cashier.itemMaxPercent,
    ).toBe(7);
  });
});