/**
 * CheckoutFlow — the shared self-service purchase flow (catalog choice →
 * customer form → external Wompi payment → result/activation handoff).
 *
 * Owns only the presentational step machine; the checkout service is
 * injected by the owning page container and the plan chooser is supplied as
 * `catalogView` so both entries (unactivated onboarding gate and the
 * subscription screen's switch-plan ledger) drive the identical flow without
 * duplicated orchestration.
 *
 * @category Component
 */
import {
  type FC,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { useDispatch } from "react-redux";
import { BillingPeriod } from "@pharmacy/shared-types";
import {
  CheckoutError,
  CheckoutTimeoutError,
  estimatePeriodAmountCents,
  type CheckoutPlan,
  type CheckoutSession,
  type SessionStatus,
  type WompiCheckoutService,
} from "../../../domain/licensing/wompi-checkout.service";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { openExternalUrl } from "../../../infrastructure/open-external";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { CheckoutCustomerForm, type CustomerDraft } from "./checkout-customer-form";
import { CheckoutPayment } from "./checkout-payment";
import { CheckoutResult, type CheckoutResultKind } from "./checkout-result";

type CheckoutStep = "catalog" | "customer" | "payment" | "result";

export interface CheckoutFlowProps {
  checkoutService: WompiCheckoutService;
  /**
   * Renders the plan chooser for this entry point. Receives the callback
   * that starts the checkout with the chosen plan and period.
   */
  renderCatalog: (onSelectPlan: (plan: CheckoutPlan, period: BillingPeriod) => void) => ReactNode;
}

export const CheckoutFlow: FC<CheckoutFlowProps> = ({
  checkoutService,
  renderCatalog,
}) => {
  const dispatch = useDispatch();
  const setPendingActivationCode = useLicenseStore(
    (s) => s.setPendingActivationCode,
  );
  const clearPendingActivationCode = useLicenseStore(
    (s) => s.clearPendingActivationCode,
  );
  const pendingActivationCode = useLicenseStore((s) => s.pendingActivationCode);

  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    BillingPeriod.MONTHLY,
  );
  const [step, setStep] = useState<CheckoutStep>("catalog");
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [lastStatus, setLastStatus] = useState<SessionStatus | null>(null);
  const [resultKind, setResultKind] = useState<CheckoutResultKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);

  const pollCancelledRef = useRef(false);

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
  if (step === "catalog") {
    return <>{renderCatalog(handleSelectPlan)}</>;
  }

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
        requiresCertificate={selectedPlan?.billingMethod === "CERTIFICATE"}
        onActivate={handleActivate}
        onRetryPayment={handleRetryOpenPayment}
        onRestart={handleRestart}
        onDismissCode={handleDismissCode}
      />
    );
  }

  // Defensive fallback (e.g. state reset mid-render): show the catalog view.
  return <>{renderCatalog(handleSelectPlan)}</>;
};
