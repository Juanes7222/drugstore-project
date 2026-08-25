/**
 * LicensingPlansPage — standalone plan purchase screen.
 *
 * Wiring container owned by the local architecture layer: fetches the public
 * plan catalog and hands it to the shared CheckoutFlow, which orchestrates
 * the Wompi checkout session, external payment page, polling and the
 * activation-code handoff. Used as the onboarding gate for terminals without
 * an active license; activated terminals buy or switch plans from the merged
 * subscription screen instead.
 *
 * @category Page
 */
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import {
  createWompiCheckoutService,
  type CheckoutPlan,
  type WompiCheckoutService,
} from "../../../domain/licensing/wompi-checkout.service";
import { CheckoutFlow } from "./checkout-flow";
import { PlanCatalog } from "./plan-catalog";

export const LicensingPlansPage: FC = () => {
  // ---- Catalog wiring ----
  const checkoutService = useMemo<WompiCheckoutService>(
    () => createWompiCheckoutService(),
    [],
  );
  const [plans, setPlans] = useState<CheckoutPlan[] | null>(null);
  const [plansErrorCode, setPlansErrorCode] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    setPlansErrorCode(null);
    checkoutService
      .fetchPlans()
      .then((result) => setPlans(result))
      .catch(() => setPlansErrorCode("PLANS_LOAD_FAILED"));
  }, [checkoutService]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  return (
    <CheckoutFlow
      checkoutService={checkoutService}
      renderCatalog={
        (onSelectPlan) => (
          <PlanCatalog
            plans={plans ?? []}
            isLoading={plans === null && !plansErrorCode}
            errorCode={plansErrorCode}
            onSelectPlan={onSelectPlan}
          />
        )
      }
    />
  );
};
