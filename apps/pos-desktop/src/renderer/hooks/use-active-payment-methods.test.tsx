/**
 * Unit tests for useActivePaymentMethods — the shared hook that loads the
 * active payment methods from the local DB (single source of truth for every
 * payment-method picker in the app).
 *
 * The hook reads the real exported `ServiceContext` (default null), so the
 * provider case wraps the hook in `ServiceContext.Provider` with a
 * services-shaped object; the no-provider case mounts the hook bare.
 *
 * Covers: DB load success, transient loading, empty list, service error, and
 * the defensive no-provider case (must return an empty list, never throw).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { type FC, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import {
  ServiceContext,
  type Services,
} from "@/components/common/service-context";
import { useActivePaymentMethods } from "./use-active-payment-methods";
import type { PaymentMethodOption } from "@/store/slices/payment-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetActivePaymentMethodsList = vi.fn();

// A Services-shaped object; the hook only reads cashShiftService. Kept as a
// stable const so the wrapper never re-creates it (the hook memoizes reload
// on the services identity). The partial object is cast to the full Services
// type since only cashShiftService is exercised here.
const testServices = {
  cashShiftService: {
    getActivePaymentMethodsList: mockGetActivePaymentMethodsList,
  },
} as unknown as Services;

const ProviderWrapper: FC<{ children: ReactNode }> = ({ children }) => (
  <ServiceContext.Provider value={testServices}>
    {children}
  </ServiceContext.Provider>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CASH_METHOD: PaymentMethodOption = {
  id: "pm-cash",
  category: "CASH",
  name: "Efectivo",
  isCash: true,
};

const CARD_METHOD: PaymentMethodOption = {
  id: "pm-debit",
  category: "DEBIT_CARD",
  name: "Tarjeta Débito",
  isCash: false,
};

/** A promise we control so the transient loading state is deterministic. */
const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useActivePaymentMethods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivePaymentMethodsList.mockReset();
  });

  it("loads the active payment methods from the DB service", async () => {
    mockGetActivePaymentMethodsList.mockResolvedValue([
      CASH_METHOD,
      CARD_METHOD,
    ]);

    const { result } = renderHook(() => useActivePaymentMethods(), {
      wrapper: ProviderWrapper,
    });

    await waitFor(() => {
      expect(result.current.methods).toEqual([CASH_METHOD, CARD_METHOD]);
    });
    expect(result.current.loading).toBe(false);
    expect(mockGetActivePaymentMethodsList).toHaveBeenCalledTimes(1);
  });

  it("reports loading while the DB read is in flight", async () => {
    const deferred = createDeferred<PaymentMethodOption[]>();
    mockGetActivePaymentMethodsList.mockReturnValue(deferred.promise);

    const { result } = renderHook(() => useActivePaymentMethods(), {
      wrapper: ProviderWrapper,
    });

    // The read is still pending → loading is true and no methods yet.
    expect(result.current.loading).toBe(true);
    expect(result.current.methods).toEqual([]);

    deferred.resolve([CASH_METHOD]);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.methods).toEqual([CASH_METHOD]);
  });

  it("returns an empty list when the DB has no active methods", async () => {
    mockGetActivePaymentMethodsList.mockResolvedValue([]);

    const { result } = renderHook(() => useActivePaymentMethods(), {
      wrapper: ProviderWrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.methods).toEqual([]);
  });

  it("returns an empty list (never throws) when the DB read fails", async () => {
    mockGetActivePaymentMethodsList.mockRejectedValue(
      new Error("local catalog not synced"),
    );

    const { result } = renderHook(() => useActivePaymentMethods(), {
      wrapper: ProviderWrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.methods).toEqual([]);
    expect(mockGetActivePaymentMethodsList).toHaveBeenCalledTimes(1);
  });

  it("is defensive outside a ServiceProvider: empty list, no throw", async () => {
    // No wrapper → useContext returns the null default.
    const { result } = renderHook(() => useActivePaymentMethods());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.methods).toEqual([]);
    expect(mockGetActivePaymentMethodsList).not.toHaveBeenCalled();
  });
});
