/**
 * LicenseStatusPage — the merged "Suscripción" screen for activated terminals.
 *
 * One section instead of the previous two: current plan (status hero +
 * benefit chips) and plan switching (delta ledger per candidate) live here.
 * Assignment and check-in history are demoted into a collapsed technical
 * details block — they are diagnostics, not the reason the owner opens this
 * screen. Catalog data comes from the public checkout endpoint; when it is
 * unreachable the benefits stay visible and the switch section degrades to a
 * calm offline note, because comparing plans requires the server while
 * selling does not stop.
 *
 * @category Page
 */

import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  DownloadIcon,
  RefreshCwIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { createLicenseService } from "../../../domain/licensing/license.service";
import {
  createWompiCheckoutService,
  type CheckoutPlan,
} from "../../../domain/licensing/wompi-checkout.service";
import { API_BASE_URL } from "../../../infrastructure/config";
import { LicenseStatus } from "@pharmacy/shared-types";
import { CheckoutFlow } from "./checkout-flow";
import { LicenseHeroCard } from "./license-hero-card";
import { CurrentPlanBenefits } from "./current-plan-benefits";
import { SubscriptionPlansPanel } from "./subscription-plans-panel";
import { LicenseAssignmentPanel } from "./license-assignment-panel";
import { LicenseCheckinPanel } from "./license-checkin-panel";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const LicenseStatusPage: FC = () => {
  const { t } = useTranslation();

  // ---- License store state ----
  const status = useLicenseStore((s) => s.status);
  const activationToken = useLicenseStore((s) => s.activationToken);
  const tokenExpiresAt = useLicenseStore((s) => s.tokenExpiresAt);
  const planName = useLicenseStore((s) => s.planName);
  const planCode = useLicenseStore((s) => s.planCode);
  const planFeatures = useLicenseStore((s) => s.planFeatures);
  const billingMethod = useLicenseStore((s) => s.billingMethod);
  const maxLocations = useLicenseStore((s) => s.maxLocations);
  const maxWorkstationsPerLocation = useLicenseStore((s) => s.maxWorkstationsPerLocation);
  const locationName = useLicenseStore((s) => s.locationName);
  const locationAddress = useLicenseStore((s) => s.locationAddress);
  const locationCity = useLicenseStore((s) => s.locationCity);
  const locationRegion = useLicenseStore((s) => s.locationRegion);
  const workstationName = useLicenseStore((s) => s.workstationName);
  const activatedAt = useLicenseStore((s) => s.activatedAt);
  const lastCheckInAt = useLicenseStore((s) => s.lastCheckInAt);
  const daysUntilExpiry = useLicenseStore((s) => s.daysUntilExpiry);
  const daysUntilGracePeriodEnd = useLicenseStore((s) => s.daysUntilGracePeriodEnd);
  const checkInsLast30Days = useLicenseStore((s) => s.checkInsLast30Days);
  const isRenewalInProgress = useLicenseStore((s) => s.isRenewalInProgress);

  // ---- Local UI state ----
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // ---- Plan catalog state (for the switch-plan ledger) ----
  // The catalog lives only in memory: prices change server-side, so there is
  // nothing worth caching locally for a decision screen.
  const checkoutService = useMemo(() => createWompiCheckoutService(), []);
  const [plans, setPlans] = useState<CheckoutPlan[] | null>(null);
  const [plansErrorCode, setPlansErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlansErrorCode(null);
    checkoutService
      .fetchPlans()
      .then((result) => {
        if (!cancelled) setPlans(result);
      })
      .catch(() => {
        if (!cancelled) {
          setPlans(null);
          setPlansErrorCode("PLANS_LOAD_FAILED");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutService]);

  // ---- Handlers ----
  const handleCheckIn = useCallback(async () => {
    setIsCheckingIn(true);
    setCheckInMessage(null);
    try {
      const licenseService = createLicenseService({ baseUrl: API_BASE_URL });
      await licenseService.checkIn();
      setCheckInMessage(t("licensing.status_page.checkin_success"));
    } catch {
      setCheckInMessage(t("licensing.status_page.checkin_error"));
    } finally {
      setIsCheckingIn(false);
    }
  }, [t]);

  const handleExport = useCallback(() => {
    setExportMessage(t("licensing.status_page.export_triggered"));
    setTimeout(() => setExportMessage(null), 4_000);
  }, [t]);

  // ---- Render ----
  const notActivated = status === LicenseStatus.UNACTIVATED;
  const isLocked = status === LicenseStatus.LOCKED || status === LicenseStatus.REVOKED;

  if (notActivated) {
    return (
      <section aria-label={t("licensing.subscription.title")} className="flex h-full flex-col items-center justify-center p-pos-lg">
        <div className="max-w-md text-center">
          <ShieldIcon className="mx-auto mb-pos-lg h-12 w-12 text-sync" aria-hidden="true" />
          <h1 className="mb-pos-md text-heading font-semibold text-ink">{t("licensing.subscription.title")}</h1>
          <p className="mb-pos-lg text-body text-ink-muted">{t("licensing.status_page.not_activated")}</p>
        </div>
      </section>
    );
  }

  const currentBasePriceCents =
    plans?.find((plan) => plan.code === planCode)?.basePriceCents ?? null;

  return (
    <CheckoutFlow
      checkoutService={checkoutService}
      renderCatalog={(onSelectPlan) => (
        <section
          aria-label={t("licensing.subscription.title")}
          className="flex h-full flex-col overflow-y-auto bg-surface p-pos-lg"
        >
          {/* ---- Header ---- */}
          <div className="mb-pos-md flex items-center justify-between">
            <div className="flex items-center gap-pos-md">
              <ShieldIcon className="h-6 w-6 text-pharma" aria-hidden="true" />
              <h1 className="text-heading font-semibold text-ink">{t("licensing.subscription.title")}</h1>
            </div>

            <div className="flex items-center gap-pos-sm">
              <button
                type="button"
                className="inline-flex items-center gap-pos-xs rounded-pos bg-pharma px-pos-md py-pos-sm text-body-sm font-semibold text-panel transition-colors hover:bg-pharma/90 disabled:opacity-50"
                onClick={handleCheckIn}
                disabled={isCheckingIn || isLocked || !activationToken}
                aria-busy={isCheckingIn}
              >
                {isCheckingIn ? (
                  <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
                )}
                {isCheckingIn ? t("licensing.status_page.renewing") : t("licensing.status_page.renew_now")}
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-pos-xs rounded-pos border border-border bg-panel px-pos-md py-pos-sm text-body-sm font-medium text-ink transition-colors hover:bg-surface-variant"
                onClick={handleExport}
              >
                <DownloadIcon className="h-4 w-4" aria-hidden="true" />
                {t("licensing.status_page.export_data")}
              </button>
            </div>
          </div>

          {/* ---- Current plan hero + benefits ---- */}
          <LicenseHeroCard
            status={status}
            planName={planName}
            planCode={planCode}
            tokenExpiresAt={tokenExpiresAt}
            daysUntilExpiry={daysUntilExpiry}
            daysUntilGracePeriodEnd={daysUntilGracePeriodEnd}
            isRenewalInProgress={isRenewalInProgress}
          />

          {(planFeatures.length > 0 || maxLocations !== null) && (
            <div className="mb-pos-md rounded-pos border border-border bg-panel p-pos-md shadow-pos-panel">
              <h2 className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-ink-muted">
                {t("licensing.status_page.features_title")}
              </h2>
              <CurrentPlanBenefits
                features={planFeatures}
                maxLocations={maxLocations}
                maxWorkstationsPerLocation={maxWorkstationsPerLocation}
              />
            </div>
          )}

          {/* ---- Feedback messages ---- */}
          {checkInMessage && (
            <div
              className="mb-pos-md flex items-center gap-pos-sm rounded-pos border px-pos-md py-pos-sm text-body-sm"
              role="alert"
            >
              {checkInMessage.includes(t("licensing.status_page.checkin_success")) ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-pharma" aria-hidden="true" />
                  <span className="text-pharma">{checkInMessage}</span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-error" aria-hidden="true" />
                  <span className="text-error">{checkInMessage}</span>
                </>
              )}
            </div>
          )}

          {exportMessage && (
            <div className="mb-pos-md flex items-center gap-pos-sm rounded-pos border border-sync/30 bg-sync/5 px-pos-md py-pos-sm text-body-sm text-sync" role="status">
              <DownloadIcon className="h-4 w-4" aria-hidden="true" />
              {exportMessage}
            </div>
          )}

          {/* ---- Switch plan (delta ledger) ---- */}
          <div className="mb-pos-md">
            <SubscriptionPlansPanel
              plans={plans ?? []}
              currentPlanCode={planCode}
              currentFeatures={planFeatures}
              currentBillingMethod={billingMethod}
              currentBasePriceCents={currentBasePriceCents}
              isLoading={plans === null && !plansErrorCode}
              errorCode={plansErrorCode}
              onSelectPlan={onSelectPlan}
            />
          </div>

          {/* ---- Technical details (collapsed by default) ---- */}
          <details className="group rounded-pos border border-border bg-panel shadow-pos-panel">
            <summary className="flex cursor-pointer list-none items-center justify-between px-pos-md py-pos-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink">
              {t("licensing.subscription.technical_details")}
              <ChevronDownIcon
                className="h-4 w-4 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="space-y-pos-md border-t border-border p-pos-md">
              <LicenseAssignmentPanel
                locationName={locationName}
                locationAddress={locationAddress}
                locationCity={locationCity}
                locationRegion={locationRegion}
                workstationName={workstationName}
                activatedAt={activatedAt}
              />
              <LicenseCheckinPanel
                status={status}
                lastCheckInAt={lastCheckInAt}
                daysUntilExpiry={daysUntilExpiry}
                daysUntilGracePeriodEnd={daysUntilGracePeriodEnd}
                checkInsLast30Days={checkInsLast30Days}
              />
            </div>
          </details>
        </section>
      )}
    />
  );
};
