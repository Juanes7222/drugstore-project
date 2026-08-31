/**
 * Payment screen — multi-method entry, change calculation, and confirmation.
 *
 * This is where the sale-completing motion handoff begins. When the payment
 * is ready and the cashier confirms, the slice is moved to the "initiating"
 * phase, the controls dim, and the screen transition is handed off to Receipt.
 *
 * Payment methods come from the local DB (DIAN categories) via the shared
 * `useActivePaymentMethods` hook — never hardcoded. The initial row defaults
 * to the cash method so exact-cash sales work out of the box.
 */
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CurrencyInput } from "@/components/common/currency-input";
import {
  PaymentMethodEntry,
  PaymentMethodOption,
} from "@/store/slices/payment-types";
import {
  addPaymentMethod,
  removePaymentMethod,
  resetPayment,
  setAuthorizationStatus,
  setCashReceived,
  updatePaymentMethod,
  updatePaymentMethodAmount,
} from "@/store/slices/payment-slice";
import {
  selectAreElectronicMethodsApproved,
  selectCanConfirmPayment,
  selectPaymentChangeCents,
  selectPaymentDifferenceCents,
  selectPaymentMethods,
  selectPaymentTotalPaidCents,
  selectCashReceivedCents,
} from "@/store/slices/payment-slice";
import {
  selectCartItems,
  selectGrandTotalCents,
  selectSelectedClient,
} from "@/store/slices/sales-slice";
import { GENERIC_CLIENT } from "@/store/slices/sales-types";
import { GENERIC_CLIENT_UUID } from "../../../domain/clients/constants/clients.constants";
import { SaleType } from "@pharmacy/shared-types";
import {
  initiateSaleCompletion,
  navigateToReceipt,
  setActiveScreen,
  setCurrentSaleId,
  selectCurrentSaleId,
  setPrescriptionFlow,
} from "@/store/slices/ui-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  useCreditService,
  useSalesPosService,
} from "@/components/common/service-context";
import type { ClientCreditState } from "../../../domain/clients/credit.service";
import { useLocalConfigStore } from "../../../domain/configuration/local-config.store";
import { useActivePaymentMethods } from "@/hooks/use-active-payment-methods";
import { usePaymentKeyboard } from "@/hooks/use-payment-keyboard";
import { useProductSyncWait } from "@/hooks/use-product-sync-wait";
import {
  ProductNotSyncedYetException,
  ChangeRequiresCashPaymentException,
} from "../../../domain/sales-pos/exceptions";
import { formatCurrency } from "@/utils/format-currency";
import { createMockPaymentGatewayService } from "@/services/payment-gateway-service.mock";
import { PaymentGatewayService } from "@/services/payment-gateway-service";
import { PaymentMethodRow } from "./payment-method-row";

const SALE_COMPLETION_INITIATE_MS = 300;

interface PaymentProcessingProps {
  gatewayService?: PaymentGatewayService;
}

export const PaymentProcessing: FC<PaymentProcessingProps> = ({
  gatewayService: injectedGateway,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const timeoutRef = useRef<number | undefined>(undefined);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSyncingProduct, setIsSyncingProduct] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const waitForProductSync = useProductSyncWait();
  const { methods: availableMethods } = useActivePaymentMethods();

  const methods = useAppSelector(selectPaymentMethods);
  const totalDue = useAppSelector(selectGrandTotalCents);
  const totalPaid = useAppSelector(selectPaymentTotalPaidCents);
  const difference = useAppSelector(selectPaymentDifferenceCents);
  const cashReceived = useAppSelector(selectCashReceivedCents);
  const change = useAppSelector(selectPaymentChangeCents);
  const canConfirm = useAppSelector(selectCanConfirmPayment);
  const allElectronicApproved = useAppSelector(
    selectAreElectronicMethodsApproved,
  );
  const currentSaleId = useAppSelector(selectCurrentSaleId);
  const selectedClient = useAppSelector(selectSelectedClient);
  const salesPosService = useSalesPosService();
  const creditService = useCreditService();

  // ---- Store credit policy state ----
  const [creditState, setCreditState] = useState<ClientCreditState | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditEnabled, setCreditEnabled] = useState<boolean>(
    () => useLocalConfigStore.getState().salesConfig.creditEnabled,
  );

  // Keep the local credit policy reactive: the owner can flip the
  // creditEnabled toggle in Settings while this screen is mounted.
  useEffect(() => {
    return useLocalConfigStore.subscribe((state) => {
      setCreditEnabled(state.salesConfig.creditEnabled);
    });
  }, []);

  const creditMethods = useMemo(
    () => methods.filter((m) => m.category === "CREDIT"),
    [methods],
  );
  const creditTotalCents = useMemo(
    () => creditMethods.reduce((sum, m) => sum + m.amountCents, 0),
    [creditMethods],
  );
  // A client counts as registered only when it is neither the UI fallback
  // (no selection) nor the DB generic consumer row — the same rule the sale
  // service enforces with GENERIC_CLIENT_UUID at confirm time.
  const isRegisteredClient =
    !!selectedClient &&
    selectedClient.id !== GENERIC_CLIENT.id &&
    selectedClient.id !== GENERIC_CLIENT_UUID;

  // Load the selected client's credit state whenever the client changes or
  // the amount charged to credit changes (so the available-balance check
  // stays live while the cashier types).
  useEffect(() => {
    let cancelled = false;
    const clientId = isRegisteredClient ? selectedClient?.id : undefined;
    if (!clientId || creditTotalCents <= 0) {
      setCreditState(null);
      setCreditLoading(false);
      return;
    }

    setCreditLoading(true);
    void creditService
      .getCreditState(clientId)
      .then((state) => {
        if (!cancelled) setCreditState(state);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[PaymentProcessing] credit state failed:", err);
        setCreditState(null);
      })
      .finally(() => {
        if (!cancelled) setCreditLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isRegisteredClient, selectedClient?.id, creditTotalCents, creditService]);

  /** True when the current credit configuration cannot be confirmed. */
  const creditBlocked = useMemo(() => {
    if (creditTotalCents <= 0) return false;
    if (!isRegisteredClient) return true;
    if (!creditState) return false; // loading or missing — backend re-validates
    if (!creditState.enabled) return true;
    return creditTotalCents > creditState.availableCents;
  }, [creditTotalCents, isRegisteredClient, creditState]);

  const creditMessage = useMemo(() => {
    if (creditTotalCents <= 0) return null;
    if (!isRegisteredClient) {
      return t("payment.credit.requires_client");
    }
    if (creditLoading) return null;
    if (!creditState) return null;
    if (!creditState.enabled) {
      return t("payment.credit.not_enabled");
    }
    if (creditTotalCents > creditState.availableCents) {
      return t("payment.credit.exceeds", {
        amount: formatCurrency(creditTotalCents),
        available: formatCurrency(creditState.availableCents),
      });
    }
    return t("payment.credit.will_use", {
      amount: formatCurrency(creditTotalCents),
    });
  }, [creditTotalCents, isRegisteredClient, creditLoading, creditState, t]);

  const gatewayService = useMemo<PaymentGatewayService>(
    () => injectedGateway ?? createMockPaymentGatewayService(),
    [injectedGateway],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  /**
   * Default method for a fresh row: the cash method when one exists,
   * otherwise the first active method.
   */
  const defaultMethod = useMemo<PaymentMethodOption | null>(() => {
    if (availableMethods.length === 0) return null;
    return (
      availableMethods.find((m) => m.isCash) ?? availableMethods[0]
    );
  }, [availableMethods]);

  // Fill the initial row with the default (cash) method once the DB list
  // arrives, so the cashier never sees an unresolved method.
  useEffect(() => {
    if (!defaultMethod) return;
    const unresolved = methods.find((m) => m.paymentMethodId === "");
    if (unresolved) {
      dispatch(
        updatePaymentMethod({ id: unresolved.id, method: defaultMethod }),
      );
    }
  }, [defaultMethod, methods, dispatch]);

  const handleAddMethod = useCallback(() => {
    // Offer the first non-cash method when available (split payments
    // usually pair cash with an electronic method); fall back to the
    // default method.
    const next =
      availableMethods.find((m) => !m.isCash) ?? defaultMethod;
    if (!next) return;
    dispatch(addPaymentMethod(next));
  }, [availableMethods, defaultMethod, dispatch]);

  const handleRemoveMethod = useCallback(
    (id: string) => {
      dispatch(removePaymentMethod(id));
    },
    [dispatch],
  );

  const handleMethodChange = useCallback(
    (id: string, method: PaymentMethodOption) => {
      const current = methods.find((m) => m.id === id);
      dispatch(updatePaymentMethod({ id, method }));
      // If the new method is non-cash, cap its amount to the remaining balance
      // so switching from cash → transferencia never leaves an overpay that
      // triggers ChangeRequiresCashPaymentException on confirm.
      if (!method.isCash && current) {
        const otherTotal = methods
          .filter((m) => m.id !== id)
          .reduce((sum, m) => sum + m.amountCents, 0);
        const remaining = Math.max(0, totalDue - otherTotal);
        if (current.amountCents > remaining) {
          dispatch(updatePaymentMethodAmount({ id, amountCents: remaining }));
        }
      }
    },
    [dispatch, methods, totalDue],
  );

  const handleAmountChange = useCallback(
    (id: string, amountCents: number) => {
      const method = methods.find((m) => m.id === id);
      if (!method) return;

      // CASH can be overpaid (change is returned). All other methods
      // (transfer, card, nequi) cannot — cap at the remaining balance so
      // the backend never rejects with ChangeRequiresCashPaymentException.
      if (!method.isCash) {
        const otherMethodsTotal = methods
          .filter((m) => m.id !== id)
          .reduce((sum, m) => sum + m.amountCents, 0);
        const remainingBalance = Math.max(0, totalDue - otherMethodsTotal);
        const capped = Math.min(amountCents, remainingBalance);
        if (capped !== amountCents) {
          dispatch(updatePaymentMethodAmount({ id, amountCents: capped }));
          return;
        }
      }

      dispatch(updatePaymentMethodAmount({ id, amountCents }));
    },
    [dispatch, methods, totalDue],
  );

  const handleCashReceivedChange = useCallback(
    (amountCents: number) => {
      dispatch(setCashReceived(amountCents));
    },
    [dispatch],
  );

  const handleAuthorize = useCallback(
    async (method: PaymentMethodEntry) => {
      dispatch(
        setAuthorizationStatus({
          id: method.id,
          status: "pending",
        }),
      );

      const result = await gatewayService.authorize({
        methodType: method.category,
        amountCents: method.amountCents,
        reference: gatewayService.generateReference(),
      });

      dispatch(
        setAuthorizationStatus({
          id: method.id,
          status: result.status,
          reference: result.reference,
          rejectionReason: result.rejectionReason,
        }),
      );
    },
    [dispatch, gatewayService],
  );

  const handleCancel = useCallback(() => {
    dispatch(resetPayment());
    setActionError(null);
    dispatch(setActiveScreen("sales"));
  }, [dispatch]);

  const cartItems = useAppSelector(selectCartItems);

  const performConfirm = useCallback(async () => {
    if (!currentSaleId) {
      throw new Error("No se encontró la venta activa. Vuelva a intentarlo.");
    }

    // Payments reference the real DB payment methods chosen by the picker.
    const resolvedPayments = methods.map((m) => ({
      paymentMethodId: m.paymentMethodId,
      amount: m.amountCents / 100, // cents → pesos (DB stores Decimal 15,2)
      transactionReference: m.reference,
      cardBrand:
        m.category === "DEBIT_CARD" || m.category === "CREDIT_CARD"
          ? "GENERIC"
          : undefined,
      cardLastFour: undefined,
      batchNumber: undefined,
      processorResponseCode: m.authorizationStatus,
    }));

    // 2. Persist to DB — consumes stock, creates SalePayment, sets CONFIRMED
    await salesPosService.confirm(currentSaleId, {
      payments: resolvedPayments,
    });

    // 3. Clear sale & payment state now that it's persisted
    dispatch(setCurrentSaleId(null));
    dispatch(resetPayment());

    // 4. Proceed with UI animation handoff
    dispatch(initiateSaleCompletion());

    timeoutRef.current = window.setTimeout(() => {
      dispatch(navigateToReceipt());
    }, SALE_COMPLETION_INITIATE_MS);
  }, [methods, currentSaleId, salesPosService, dispatch]);

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || isCompleting || creditBlocked) {
      return;
    }

    // ---- Prescription interception ----
    const itemsNeedingPrescription = cartItems.filter(
      (item) =>
        item.requiresPrescription && item.saleType !== SaleType.FREE_SALE,
    );

    if (itemsNeedingPrescription.length > 0) {
      const pendingSaleId = globalThis.crypto.randomUUID();
      const incompleteItemIds = itemsNeedingPrescription.map((item) => item.id);

      dispatch(
        setPrescriptionFlow({
          pendingSaleId,
          pendingItemId: incompleteItemIds[0],
          incompleteItemIds,
        }),
      );
      return;
    }

    // ---- Guard: must have a sale ID from create() ----
    if (!currentSaleId) {
      setActionError("No se encontró la venta activa. Vuelva a intentarlo.");
      return;
    }

    setIsCompleting(true);
    setActionError(null);

    try {
      await performConfirm();
    } catch (err) {
      // If the failure is a single unsynced product, kick the sync
      // engine and wait for the product to land on the server before
      // re-running the confirm. The cashier sees "Sincronizando producto"
      // and the retry happens transparently if it lands in time.
      if (err instanceof ProductNotSyncedYetException) {
        setIsSyncingProduct(true);
        const synced = await waitForProductSync(err.productId);
        setIsSyncingProduct(false);
        if (synced) {
          try {
            await performConfirm();
            return;
          } catch (retryErr) {
            console.error(
              "[PaymentProcessing] retry after sync failed:",
              retryErr,
            );
            setActionError(t("sales.cart.error_product_not_synced_yet"));
            return;
          }
        }
        setActionError(t("sales.cart.error_product_not_synced_yet"));
        return;
      }

      if (err instanceof ChangeRequiresCashPaymentException) {
        setActionError(
          t("payment.error_change_requires_cash", {
            defaultValue:
              "El vuelto solo puede entregarse si hay un pago en efectivo. Ajusta el monto de la transferencia al total exacto.",
          }),
        );
        return;
      }

      console.error("[PaymentProcessing] confirm failed:", err);
      setActionError(
        err instanceof Error ? err.message : "Error al confirmar la venta.",
      );
    } finally {
      setIsCompleting(false);
    }
  }, [
    canConfirm,
    isCompleting,
    creditBlocked,
    currentSaleId,
    cartItems,
    performConfirm,
    waitForProductSync,
    t,
    dispatch,
  ]);

  const differenceText = useMemo(() => {
    if (difference < 0) {
      return t("payment.difference_missing", {
        amount: formatCurrency(Math.abs(difference)),
      });
    }

    if (difference > 0) {
      return t("payment.difference_excess", {
        amount: formatCurrency(difference),
      });
    }

    if (!allElectronicApproved) {
      return t("payment.difference_balanced_auth_pending");
    }

    return t("payment.difference_balanced");
  }, [difference, allElectronicApproved, t]);

  // ---- Keyboard-first payment flow -------------------------------------
  // The hook owns the global keydown listener (capture phase) and only
  // tracks WHICH target is active; this screen focuses the real input of
  // that target so typed digits land natively in the amount field.
  const { selection, showCashReceived, moveSelection } = usePaymentKeyboard({
    isCompleting,
    canConfirm,
    onConfirm: handleConfirm,
    onAddMethod: handleAddMethod,
  });

  // Row amount inputs keyed by method.id + the cash "received" input.
  const amountInputRefs = useRef(new Map<string, HTMLInputElement>());
  const receivedInputRef = useRef<HTMLInputElement>(null);

  // Focus follows the keyboard selection: the row's real amount input or
  // the received field. A null selection leaves focus where it is.
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "row") {
      amountInputRefs.current.get(selection.rowId)?.focus();
    } else {
      receivedInputRef.current?.focus();
    }
  }, [selection]);

  const registerAmountInputRef = useCallback(
    (methodId: string) =>
      (node: HTMLInputElement | null) => {
        if (node) {
          amountInputRefs.current.set(methodId, node);
        } else {
          amountInputRefs.current.delete(methodId);
        }
      },
    [],
  );

  return (
    <section
      aria-label={t("payment.title")}
      className="flex h-full flex-col items-center overflow-y-auto p-pos-md"
      style={{
        backgroundColor: "var(--color-surface)",
      }}
    >
      <div className="w-full max-w-3xl">
        <div className="mb-pos-md text-center">
          <span
            className="text-caption font-semibold uppercase tracking-wide"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {t("payment.total_due")}
          </span>
          <div
            data-testid="payment-total-due"
            className="mt-pos-sm text-total font-bold font-data tabular-nums"
            style={{ color: "var(--color-ink)" }}
          >
            {formatCurrency(totalDue)}
          </div>
        </div>

        <div className="pos-panel p-pos-md">
          <div className="mb-pos-sm flex items-center justify-between">
            <h2
              className="text-ui font-semibold"
              style={{ color: "var(--color-ink)" }}
            >
              {t("payment.methods_title")}
            </h2>
            <span
              className="font-data tabular-nums text-body-sm"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
              }}
            >
              {t("payment.total_paid")}: {formatCurrency(totalPaid)}
            </span>
          </div>

          <p
            className="mt-pos-xs text-caption"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
            }}
          >
            {t("payment.keyboard_hint")}
          </p>

          <div>
            {methods.map((method, index) => (
              <PaymentMethodRow
                key={method.id}
                index={index}
                method={method}
                methods={availableMethods}
                isOnlyMethod={methods.length === 1}
                disabled={isCompleting}
                isActive={
                  selection?.kind === "row" && selection.rowId === method.id
                }
                inputRef={registerAmountInputRef(method.id)}
                showCashReceived={showCashReceived}
                onMoveToReceived={() => moveSelection(1)}
                onMethodChange={handleMethodChange}
                onAmountChange={handleAmountChange}
                onRemove={handleRemoveMethod}
                onAuthorize={handleAuthorize}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddMethod}
            disabled={isCompleting}
            className="pos-button pos-button-secondary mt-pos-md w-full"
          >
            {t("payment.add_method")}
          </button>
        </div>

        {!creditEnabled && isRegisteredClient && (
          <div
            className="mt-pos-md flex items-center gap-2 rounded-pos p-pos-md text-body-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-sync) 10%, transparent)",
              color: "var(--color-ink-muted)",
              border:
                "1px solid color-mix(in srgb, var(--color-sync) 25%, transparent)",
            }}
            role="status"
            aria-live="polite"
          >
            {t("payment.credit.disabled_notice")}
          </div>
        )}

        {creditTotalCents > 0 && (
          <div
            className="mt-pos-md rounded-pos p-pos-md"
            style={{
              backgroundColor: creditBlocked
                ? "color-mix(in srgb, var(--color-urgency) 8%, white)"
                : "color-mix(in srgb, var(--color-pharma) 8%, white)",
              border: `1px solid ${
                creditBlocked
                  ? "color-mix(in srgb, var(--color-urgency) 25%, transparent)"
                  : "color-mix(in srgb, var(--color-pharma) 25%, transparent)"
              }`,
            }}
            role={creditBlocked ? "alert" : "status"}
          >
            <div className="mb-pos-xs flex items-center justify-between">
              <span
                className="text-caption font-semibold uppercase tracking-wide"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {t("payment.credit.panel_title")}
              </span>
              <span
                className="font-data tabular-nums text-caption font-semibold"
                style={{ color: "var(--color-pharma)" }}
              >
                {formatCurrency(creditTotalCents)}
              </span>
            </div>

            {creditLoading && (
              <p
                className="m-0 flex items-center gap-2 text-body-sm"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <span
                  className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
                {t("common.loading")}
              </p>
            )}

            {!creditLoading && isRegisteredClient && creditState && (
              <div className="mb-pos-xs flex flex-wrap gap-x-6 gap-y-1">
                <CreditStat
                  label={t("payment.credit.limit")}
                  value={formatCurrency(creditState.creditLimitCents)}
                />
                <CreditStat
                  label={t("payment.credit.debt")}
                  value={formatCurrency(creditState.usedCents)}
                />
                <CreditStat
                  label={t("payment.credit.available")}
                  value={formatCurrency(creditState.availableCents)}
                />
              </div>
            )}

            {creditMessage && (
              <p
                className="m-0 text-body-sm"
                style={{
                  color: creditBlocked
                    ? "var(--color-urgency)"
                    : "var(--color-pharma)",
                }}
              >
                {creditMessage}
              </p>
            )}
          </div>
        )}

        <div
          className="mt-pos-md flex items-center justify-between rounded px-pos-md py-pos-sm"
          style={{
            backgroundColor:
              difference === 0 && allElectronicApproved
                ? "color-mix(in srgb, var(--color-pharma) 8%, white)"
                : "color-mix(in srgb, var(--color-urgency) 8%, white)",
          }}
        >
          <span
            className="text-body font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {difference === 0 && allElectronicApproved
              ? t("payment.ready")
              : t("payment.difference_label")}
          </span>
          <span
            className="font-data tabular-nums text-body font-semibold"
            style={{
              color:
                difference === 0 && allElectronicApproved
                  ? "var(--color-pharma)"
                  : "var(--color-urgency)",
            }}
          >
            {differenceText}
          </span>
        </div>

        {showCashReceived && (
          <div
            className="mt-pos-md grid grid-cols-2 items-start gap-pos-md rounded-pos p-pos-sm pl-pos-md"
            style={{
              ...(selection?.kind === "received"
                ? {
                    backgroundColor:
                      "color-mix(in srgb, var(--color-pharma) 6%, transparent)",
                    boxShadow: "inset 3px 0 0 var(--color-pharma)",
                  }
                : {}),
            }}
          >
            <div className="flex flex-col gap-pos-xs">
              <CurrencyInput
                value={cashReceived}
                onChange={handleCashReceivedChange}
                label={t("payment.received")}
                aria-label={t("payment.received")}
                disabled={isCompleting}
                inputRef={receivedInputRef}
              />
            </div>
            <div className="flex flex-col gap-pos-xs">
              <span
                className="text-caption font-medium"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 60%, transparent)",
                }}
              >
                {t("payment.change")}
              </span>
              <span
                className="font-data tabular-nums text-total font-semibold"
                style={{
                  color:
                    change < 0 ? "var(--color-urgency)" : "var(--color-pharma)",
                }}
              >
                {formatCurrency(change)}
              </span>
            </div>
          </div>
        )}

        {isSyncingProduct && (
          <div
            className="mt-pos-md flex items-center gap-2 rounded-pos p-pos-md text-body-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-sync) 12%, transparent)",
              color: "var(--color-sync)",
            }}
            role="status"
            aria-live="polite"
          >
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            {t("sales.cart.syncing_product")}
          </div>
        )}

        {actionError && !isSyncingProduct && (
          <div
            className="mt-pos-md rounded-pos p-pos-md text-body-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-urgency) 12%, transparent)",
              color: "var(--color-urgency)",
            }}
            role="alert"
          >
            {actionError}
          </div>
        )}

        <div className="mt-pos-xl flex justify-end gap-pos-md">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCompleting}
            className="pos-button pos-button-secondary px-pos-xl"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || isCompleting || creditBlocked}
            className="pos-button pos-button-primary px-pos-xl"
          >
            {isCompleting ? t("payment.confirming") : t("payment.confirm")}
          </button>
        </div>
      </div>
    </section>
  );
};

/** Small stat cell used inside the credit panel. */
const CreditStat: FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <span className="inline-flex flex-col gap-0.5">
    <span
      className="text-caption"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {label}
    </span>
    <span
      className="font-data tabular-nums text-body font-semibold"
      style={{ color: "var(--color-ink)" }}
    >
      {value}
    </span>
  </span>
);
