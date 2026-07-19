/**
 * Payment screen — multi-method entry, change calculation, and confirmation.
 *
 * This is where the sale-completing motion handoff begins. When the payment
 * is ready and the cashier confirms, the slice is moved to the "initiating"
 * phase, the controls dim, and the screen transition is handed off to Receipt.
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
  ElectronicPaymentMethodType,
  PaymentMethodEntry,
  PaymentMethodType,
} from "@/store/slices/payment-types";
import {
  addPaymentMethod,
  removePaymentMethod,
  resetPayment,
  setAuthorizationStatus,
  setCashReceived,
  updatePaymentMethodAmount,
  updatePaymentMethodType,
} from "@/store/slices/payment-slice";
import {
  selectAreElectronicMethodsApproved,
  selectCanConfirmPayment,
  selectCashOwedCents,
  selectPaymentChangeCents,
  selectPaymentDifferenceCents,
  selectPaymentMethods,
  selectPaymentTotalPaidCents,
  selectCashReceivedCents,
} from "@/store/slices/payment-slice";
import { selectCartItems, selectTotalCents } from "@/store/slices/sales-slice";
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
import { useSalesPosService } from "@/components/common/service-context";
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
  const [actionError, setActionError] = useState<string | null>(null);

  const methods = useAppSelector(selectPaymentMethods);
  const totalDue = useAppSelector(selectTotalCents);
  const totalPaid = useAppSelector(selectPaymentTotalPaidCents);
  const difference = useAppSelector(selectPaymentDifferenceCents);
  const cashOwed = useAppSelector(selectCashOwedCents);
  const cashReceived = useAppSelector(selectCashReceivedCents);
  const change = useAppSelector(selectPaymentChangeCents);
  const canConfirm = useAppSelector(selectCanConfirmPayment);
  const allElectronicApproved = useAppSelector(
    selectAreElectronicMethodsApproved,
  );
  const currentSaleId = useAppSelector(selectCurrentSaleId);
  const salesPosService = useSalesPosService();

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

  const handleAddMethod = useCallback(() => {
    dispatch(addPaymentMethod());
  }, [dispatch]);

  const handleRemoveMethod = useCallback(
    (id: string) => {
      dispatch(removePaymentMethod(id));
    },
    [dispatch],
  );

  const handleTypeChange = useCallback(
    (id: string, type: PaymentMethodType) => {
      dispatch(updatePaymentMethodType({ id, type }));
    },
    [dispatch],
  );

  const handleAmountChange = useCallback(
    (id: string, amountCents: number) => {
      dispatch(updatePaymentMethodAmount({ id, amountCents }));
    },
    [dispatch],
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
        methodType: method.type as ElectronicPaymentMethodType,
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

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || isCompleting) {
      return;
    }

    // ---- Prescription interception ----
    const itemsNeedingPrescription = cartItems.filter(
      (item) =>
        item.requiresPrescription && item.saleType !== SaleType.FREE_SALE,
    );

    if (itemsNeedingPrescription.length > 0) {
      const pendingSaleId = globalThis.crypto.randomUUID();
      const incompleteItemIds = itemsNeedingPrescription.map(
        (item) => item.id,
      );

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
      setActionError('No se encontró la venta activa. Vuelva a intentarlo.');
      return;
    }

    setIsCompleting(true);
    setActionError(null);

    try {
      // 1. Resolve frontend payment types → DB payment method UUIDs
      const resolvedPayments = await Promise.all(
        methods.map(async (m) => ({
          paymentMethodId: await salesPosService.resolvePaymentMethodId(m.type),
          amount: m.amountCents / 100, // cents → pesos (DB stores Decimal 15,2)
          transactionReference: m.reference,
          cardBrand: m.type === 'card' ? 'GENERIC' : undefined,
          cardLastFour: undefined,
          batchNumber: undefined,
          processorResponseCode: m.authorizationStatus,
        })),
      );

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
    } catch (err) {
      console.error('[PaymentProcessing] confirm failed:', err);
      setActionError(
        err instanceof Error ? err.message : 'Error al confirmar la venta.',
      );
      setIsCompleting(false);
    }
  }, [canConfirm, isCompleting, currentSaleId, cartItems, methods, salesPosService, dispatch]);

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

  const showCashReceived = cashOwed > 0;

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

          <div>
            {methods.map((method, index) => (
              <PaymentMethodRow
                key={method.id}
                index={index}
                method={method}
                isOnlyMethod={methods.length === 1}
                disabled={isCompleting}
                onTypeChange={handleTypeChange}
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
          <div className="mt-pos-md grid grid-cols-2 gap-pos-md">
            <CurrencyInput
              value={cashReceived}
              onChange={handleCashReceivedChange}
              label={t("payment.received")}
              aria-label={t("payment.received")}
              disabled={isCompleting}
            />
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
                    change < 0
                      ? "var(--color-urgency)"
                      : "var(--color-pharma)",
                }}
              >
                {formatCurrency(change)}
              </span>
            </div>
          </div>
        )}

        {actionError && (
          <div
            className="mt-pos-md rounded-pos p-pos-md text-body-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-urgency) 12%, transparent)',
              color: 'var(--color-urgency)',
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
            disabled={!canConfirm || isCompleting}
            className="pos-button pos-button-primary px-pos-xl"
          >
            {isCompleting ? t("payment.confirming") : t("payment.confirm")}
          </button>
        </div>
      </div>
    </section>
  );
};
