/**
 * useActivePaymentMethods — shared hook that loads the active payment
 * methods from the local database.
 *
 * Single source of truth for every payment-method picker in the app
 * (sales, fiscal adjustments, returns). The list comes from
 * `CashShiftService.getActivePaymentMethodsList()` which reads the
 * `PaymentMethod` rows synced from the server (DIAN categories) — the UI
 * never hardcodes a payment-method list.
 *
 * The hook is defensive: outside a `<ServiceProvider>` (unit tests, odd
 * mount points) it returns an empty list instead of throwing, so pickers
 * that receive their methods via props keep working.
 */
import { useCallback, useContext, useEffect, useState } from "react";
import { ServiceContext } from "@/components/common/service-context";
import type { PaymentMethodOption } from "@/store/slices/payment-types";

export interface ActivePaymentMethodsState {
  methods: PaymentMethodOption[];
  loading: boolean;
}

export function useActivePaymentMethods(): ActivePaymentMethodsState {
  const services = useContext(ServiceContext);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!services) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await services.cashShiftService.getActivePaymentMethodsList();
      setMethods(list);
    } catch {
      // Leave the list empty — pickers fall back to their placeholder state
      // (or stay disabled) until the local catalog is synced.
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { methods, loading };
}
