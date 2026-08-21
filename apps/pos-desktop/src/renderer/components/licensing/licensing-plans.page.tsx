/**
 * LicensingPlansPage — plan catalog, self-service checkout and post-payment
 * activation-code handoff.
 *
 * Wiring container owned by the local architecture layer: fetches the public
 * plan catalog, creates the Wompi checkout session, opens the hosted payment
 * page in the system browser, polls the session to a terminal state and
 * stores the activation code returned by an approved NEW_SUBSCRIPTION
 * payment. All presentational pieces live in the sibling components below.
 *
 * Steps: catalog → customer form → payment (external) → result.
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch } from "react-redux";
import { BillingPeriod } from "@pharmacy/shared-types";
import { createWompiCheckoutService } from "../../../domain/licensing/wompi-checkout.service";
import {
  CheckoutError,
  CheckoutTimeoutError,
  estimatePeriodAmountCents,
  type CheckoutPlan,
  type CheckoutSession,
  type SessionStatus,
} from "../../../domain/licensing/wompi-checkout.service";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { openExternalUrl } from "../../../infrastructure/open-external";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { PlanCatalog } from "./plan-catalog";
import { CheckoutCustomerForm, type CustomerDraft } from "./checkout-customer-form";
import { CheckoutPayment } from "./checkout-payment";
import { CheckoutResult, type CheckoutResultKind } from "./checkout-result";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type CheckoutStep = "catalog" | "customer" | "payment" | "result";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const LicensingPlansPage: FC = () => {
  const dispatch = useDispatch();
  const setPendingActivationCode = useLicenseStore(
    (s) => s.setPendingActivationCode,
  );
  const clearPendingActivationCode = useLicenseStore(
    (s) => s.clearPendingActivationCode,
  );
  const pendingActivationCode = useLicenseStore((s) => s.pendingActivationCode);

  // ---- Catalog state ----
  const [plans, setPlans] = useState<CheckoutPlan[] | null>(null);
  const [plansErrorCode, setPlansErrorCode] = useState<string | null>(null);

  // ---- Flow state ----
  const [step, setStep] = useState<CheckoutStep>("catalog");
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    BillingPeriod.MONTHLY,
  );
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [lastStatus, setLastStatus] = useState<SessionStatus | null>(null);
  const [resultKind, setResultKind] = useState<CheckoutResultKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);

  const checkoutService = useMemo(
    () => createWompiCheckoutService(),
    [],
  );
  const pollCancelledRef = useRef(false);

  // ---- Catalog load ----
  useEffect(() => {
    let cancelled = false;
    checkoutService
      .fetchPlans()
      .then((result) => {
        if (!cancelled) setPlans(result);
      })
      .catch(() => {
        if (!cancelled) setPlansErrorCode("PLANS_LOAD_FAILED");
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutService]);

  // ---- Checkout orchestration ----
  const handleSelectPlan = useCallback(
    (plan: CheckoutPlan, period: BillingPeriod) => {
      setSelectedPlan(plan);
      setBillingPeriod(period);
      setSubmitErrorCode(null);
      setStep("customer");
    },
    [],
  );

  const handleSubmitCustomer = useCallback(
    async (draft: CustomerDraft) => {
      setIsSubmitting(true);
      setSubmitErrorCode(null);
      try {
        const created = await checkoutService.createSession(draft);
        setSession(created);
        setStep("payment");

        const opened = await openExternalUrl(created.checkoutUrl);
        if (!opened) {
          // Browser blocked (dev only) — user can retry from the payment step.
          setSubmitErrorCode("CHECKOUT_OPEN_FAILED");
          return;
        }

        pollCancelledRef.current = false;
        setIsPolling(true);
        const terminal = await checkoutService.pollUntilTerminal(
          created.reference,
          {
            intervalMs: 5_000,
            timeoutMs: 10 * 60_000,
            onStatus: setLastStatus,
          },
        );
        setIsPolling(false);

        if (terminal.status === "APPROVED") {
          if (terminal.activationCode) {
            setPendingActivationCode(terminal.activationCode);
          }
          setResultKind("approved");
        } else if (
          terminal.status === "DECLINED" ||
          terminal.status === "ERROR" ||
          terminal.status === "VOIDED"
        ) {
          setResultKind("declined");
        }
        setLastStatus(terminal);
        setStep("result");
      } catch (error) {
        setIsPolling(false);
        if (error instanceof CheckoutTimeoutError) {
          setResultKind("timeout");
          setStep("result");
        } else if (error instanceof CheckoutError) {
          setSubmitErrorCode("CHECKOUT_CREATE_FAILED");
          setStep("customer");
        } else {
          setSubmitErrorCode("CHECKOUT_NETWORK");
          setStep("customer");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [checkoutService, setPendingActivationCode],
  );

  // The payment page may be closed without paying; reopening the same
  // session URL is safe because the server keeps the pending record.
  const handleRetryOpenPayment = useCallback(async () => {
    if (!session) return;
    const opened = await openExternalUrl(session.checkoutUrl);
    if (!opened) setSubmitErrorCode("CHECKOUT_OPEN_FAILED");
  }, [session]);

  const handleRestart = useCallback(() => {
    pollCancelledRef.current = true;
    setSession(null);
    setLastStatus(null);
    setResultKind(null);
    setSelectedPlan(null);
    setSubmitErrorCode(null);
    setStep("catalog");
  }, []);

  const handleActivate = useCallback(() => {
    dispatch(setActiveScreen("license-status"));
  }, [dispatch]);

  const handleDismissCode = useCallback(() => {
    clearPendingActivationCode();
  }, [clearPendingActivationCode]);

  // ---- Render ----
  if (step === "customer" && selectedPlan) {
    return (
      <CheckoutCustomerForm
        planName={selectedPlan.name}
        planCode={selectedPlan.code}
        billingPeriod={billingPeriod}
        amountCents={estimatePeriodAmountCents(
          selectedPlan.basePriceCents,
          billingPeriod,
        )}
        isSubmitting={isSubmitting}
        errorCode={submitErrorCode}
        onSubmit={handleSubmitCustomer}
        onBack={() => {
          setSubmitErrorCode(null);
          setStep("catalog");
        }}
      />
    );
  }

  if (step === "payment" && session) {
    return (
      <CheckoutPayment
        isPolling={isPolling}
        lastStatus={lastStatus}
        errorCode={submitErrorCode}
        onRetryOpen={handleRetryOpenPayment}
        onCancel={() => {
          pollCancelledRef.current = true;
          setIsPolling(false);
          setStep("catalog");
        }}
      />
    );
  }

  if (step === "result" && resultKind) {
    return (
      <CheckoutResult
        kind={resultKind}
        activationCode={pendingActivationCode}
        onActivate={handleActivate}
        onRetryPayment={handleRetryOpenPayment}
        onRestart={handleRestart}
        onDismissCode={handleDismissCode}
      />
    );
  }

  return (
    <PlanCatalog
      plans={plans ?? []}
      isLoading={plans === null && !plansErrorCode}
      errorCode={plansErrorCode}
      onSelectPlan={handleSelectPlan}
    />
  );
};