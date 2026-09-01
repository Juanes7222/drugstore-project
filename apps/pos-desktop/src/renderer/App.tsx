/**
 * Root application component — Pharmacy POS Terminal.
 *
 * Renders the active screen inside the persistent AppShell and coordinates
 * the screen-to-screen motion handoff via the ui slice.
 *
 * Ownership of the local database and domain-service instances is held by
 * the <ServiceProvider> wrapper so every page can call the real
 * Prisma-backed services instead of hardcoded mocks.
 */
import { type FC, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { Toaster } from "sileo";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/common/app-shell";
import { DatabaseProof } from "@/components/DatabaseProof/database-proof";
import { Home } from "@/components/Home/home";
import { SalesTransaction } from "@/components/SalesTransaction/sales-transaction";
import { PaymentProcessing } from "@/components/PaymentProcessing/payment-processing";
import { Receipt } from "@/components/Receipt/receipt";
import { NavigationSidebar } from "@/components/Navigation/navigation-sidebar";
import { canAccessScreen } from "@/components/Navigation/screen-access";
import { CashShiftPage } from "@/components/cash-shift/cash-shift.page";
import { ClientsPage } from "@/components/clients/clients.page";
import { FiscalPage } from "../domain/fiscal/fiscal.page";
import { SalesHistoryPage } from "../domain/sales-pos/sales-history.page";
import { ReturnsPage } from "@/components/returns/returns.page";
import { InventoryAdjustmentsPage } from "@/components/inventory-adjustments/inventory-adjustments.page";
import { InventoryLotsPage } from "@/components/inventory-lots/inventory-lots.page";
import { InventoryCountPage } from "@/components/inventory-count/inventory-count.page";
import { ProductsPage } from "@/components/products/products.page";
import { ProductosMainPage } from "@/components/productos/productos-main.page";
import { PurchasesMainPage } from "@/components/purchases/purchases-main.page";
import { SuppliersPage } from "@/components/purchases/suppliers.page";
import { PurchaseOrdersPage } from "@/components/purchases/purchase-orders.page";
import { PurchaseReceptionsPage } from "@/components/purchases/purchase-receptions.page";
import { SupplierReturnsPage } from "@/components/purchases/supplier-returns.page";
import { PrescriptionsPage } from "@/components/prescriptions/prescriptions.page";
import { ReportsPage } from "@/components/reports/reports.page";
import { SyncHealthPage } from "@/components/sync/sync-health.page";
import { LocalNetworkPage } from "@/components/local-sync/local-network.page";
import { RecoveryPage } from "@/components/recovery/recovery.page";
import { AboutPage } from "@/components/update/about.page";
import { LicenseStatusPage } from "@/components/licensing/license-status.page";
import { LicensingPlansPage } from "@/components/licensing/licensing-plans.page";
import { ActivationPage } from "@/components/licensing/activation.page";
import { CompanySetupWizard } from "@/components/company-setup/company-setup-wizard";
import { CertificateSetupPage } from "../domain/fiscal/certificate.page";
import { PrintingContainer } from "@/components/printing/printing-container";
import { PrintersPage } from "@/components/printing/printers.page";
import { PrintQueuePage } from "@/components/printing/print-queue.page";
import { SetupWizardPage } from "@/components/printing/setup-wizard.page";
import { TenantConfigPage } from "@/components/config/tenant-config.page";
import { UpdateCheckInterceptor } from "@/components/update/update-check-interceptor";
import { LoginPage } from "@/components/auth/login.page";
import { ForgotPasswordPage } from "@/components/auth/forgot-password.page";
import { ResetPasswordPage } from "@/components/auth/reset-password.page";
import { UserManagementPage } from "@/components/auth/user-management.page";
import { AuditLogView } from "@/components/auth/audit-log-view";
import { SessionView } from "@/components/auth/sessions/session-view";
import { OfflineModeBanner } from "@/components/auth/offline/offline-mode-banner";
import { PendingBlessingModal } from "@/components/auth/offline/pending-blessing-modal";
import { ErrorBoundary } from "./components/common/error-boundary";
import { ServiceProvider, useServiceContext } from "./components/common/service-context";
import { AssistantLayer } from "./components/assistant/assistant-layer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectActiveScreen, setActiveScreen } from "@/store/slices/ui-slice";
import type { PosScreen } from "@/store/slices/ui-types";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRequireActiveShift } from "@/hooks/use-require-active-shift";
import { ShiftRequiredOverlay } from "@/components/common/shift-required-overlay";
import { useLocalSessionStore } from "../domain/auth/local-session.store";
import { useLicenseStore } from "../domain/licensing/license.store";
import { LicenseStatus } from "@pharmacy/shared-types";
import { createLicenseService } from "../domain/licensing/license.service";
import { API_BASE_URL } from "../infrastructure/config";
import { DB_PROOF_ENABLED } from "@infra/config";

const SCREEN_TRANSITION_DURATION_S = 0.3;

/**
 * Navigation order for directional screen transitions.
 *
 * Screens earlier in the list are conceptually "to the left" of later ones.
 * Moving forward (later index) slides the incoming screen in from the right;
 * moving backward slides it in from the left. Screens not listed (auth
 * screens) keep the default forward direction — they render outside the
 * AnimatePresence router anyway.
 */
const SCREEN_ORDER: PosScreen[] = [
  "home",
  "sales",
  "payment",
  "receipt",
  "prescriptions",
  "cash-shift",
  "returns",
  "productos-main",
  "products",
  "inventory-lots",
  "inventory-adjustments",
  "inventory-count",
  "purchases-main",
  "suppliers",
  "purchase-orders",
  "purchase-receptions",
  "supplier-returns",
  "clients",
  "sales-history",
  "reports",
  "admin-menu",
  "fiscal",
  "sync-health",
  "local-network",
  "recovery",
  "about",
  "user-management",
  "audit-log",
  "license-status",
  "licensing-plans",
  "printing",
  "printers",
  "print-queue",
  "setup-wizard",
  "offline-sessions",
];

// ---------------------------------------------------------------------------
// InnerApp — the actual screen router, rendered once ServiceProvider is ready
// ---------------------------------------------------------------------------

const InnerApp: FC = () => {
  const dispatch = useAppDispatch();
  const activeScreen = useAppSelector(selectActiveScreen);
  const isOnline = useOnlineStatus();
  const shouldReduceMotion = useReducedMotion();
  const { t } = useTranslation();

  // Directional transitions — slides depend on whether the new screen sits
  // before or after the previous one in the navigation order. The previous
  // screen is tracked in a ref (updated after render) so the direction is
  // computed for the exact transition being rendered.
  const prevScreenRef = useRef<PosScreen>(activeScreen);
  const navDirection = useMemo(() => {
    const prevIdx = SCREEN_ORDER.indexOf(prevScreenRef.current);
    const nextIdx = SCREEN_ORDER.indexOf(activeScreen);
    if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
      return nextIdx > prevIdx ? 1 : -1;
    }
    return 1;
  }, [activeScreen]);

  useEffect(() => {
    prevScreenRef.current = activeScreen;
  }, [activeScreen]);

  // Assistant layer renders overlays and registers global shortcuts.
  // Must be mounted at this level (inside ServiceProvider, outside screen router).
  const assistantLayer = <AssistantLayer />;

  // Live session data from the Zustand store (populated at login).
  // When there is no session yet we render a login fallback.
  const session = useLocalSessionStore((s) => s.session);

  // ---- Sales-screen shift guard -----------------------------------------
  const { hasActiveShift, isLoading: shiftLoading } = useRequireActiveShift();

  // Start the sync scheduler once we have a valid authenticated session.
  // Created in initializeServices() without a token (first launch), then
  // wired up here so that seed data (products, lots, etc.) is pulled from
  // the server immediately after login.
  //
  // The token is refreshed on EVERY session change, not just the first one,
  // so that re-login after token expiry propagates the new token to all
  // sub-services.  start() is called only once (guarded by isSyncStarted).
  const svc = useServiceContext();
  const isSyncStarted = useRef(false);
  const isReportSchedulerStarted = useRef(false);
  const prevTokenRef = useRef<string | undefined>(undefined);
  const prevWorkstationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!session?.accessToken) return;

    // Re-hydrate cash shift store when workstation changes (login / user switch).
    // Called every time session changes so that the store reflects the correct
    // workstation state even if hydrateFromDb at app startup ran with 'unknown'.
    if (session.workstationId !== prevWorkstationRef.current) {
      prevWorkstationRef.current = session.workstationId;
      svc.cashShiftService.hydrateStore();
    }

    // Update the token in sub-services every time it changes
    // (including the initial login AND subsequent re-logins).
    if (session.accessToken !== prevTokenRef.current) {
      prevTokenRef.current = session.accessToken;
      svc.syncScheduler.updateAccessToken(session.accessToken);
    }

    // Start the scheduler only once (not on re-login)
    if (!isSyncStarted.current) {
      isSyncStarted.current = true;
      svc.syncScheduler.start();
    }

    // Start the local report scheduler once per session.  It evaluates
    // every minute and runs any schedule whose `nextRunAt` is in the past
    // while the application is open.
    if (!isReportSchedulerStarted.current) {
      isReportSchedulerStarted.current = true;
      svc.reportScheduler.start();
    }
  }, [session?.accessToken, session?.workstationId, svc]);

  // Restore license from server on startup if not activated
  const licenseRestored = useRef(false);
  useEffect(() => {
    if (licenseRestored.current) return;
    if (!session?.accessToken) return;
    const state = useLicenseStore.getState();
    if (state.status !== LicenseStatus.UNACTIVATED) {
      licenseRestored.current = true;
      return;
    }
    licenseRestored.current = true;
    const svc = createLicenseService({ baseUrl: API_BASE_URL });
    svc.restoreLicense();
  }, [session?.accessToken]);

  // After a successful activation (ActivationPage dispatches
  // "license:activated"), transition into the main POS interface.
  useEffect(() => {
    const handleActivated = () => {
      dispatch(setActiveScreen("home"));
    };
    window.addEventListener("license:activated", handleActivated);
    return () => window.removeEventListener("license:activated", handleActivated);
  }, [dispatch]);

  const licenseStatus = useLicenseStore((s) => s.status);

  // Route guard — a screen the session's role cannot open is redirected to
  // home before it can render, so its mount-time requests never fire (and
  // never fail with authorization errors). Covers every navigation path:
  // sidebar, in-page redirects, deep-linked ui state left by a previous
  // session.
  useEffect(() => {
    if (!session) return;
    if (!canAccessScreen(session, activeScreen)) {
      dispatch(setActiveScreen("home"));
    }
  }, [session, activeScreen, dispatch]);

  const variants: Variants = {
    initial: (direction: number) =>
      shouldReduceMotion
        ? { opacity: 0 }
        : { opacity: 0, x: 24 * direction, scale: 0.99 },
    animate: shouldReduceMotion
      ? { opacity: 1 }
      : { opacity: 1, x: 0, scale: 1 },
    exit: (direction: number) =>
      shouldReduceMotion
        ? { opacity: 0 }
        : { opacity: 0, x: -24 * direction, scale: 0.99 },
  };

  if (
    !session &&
    activeScreen !== "login" &&
    activeScreen !== "forgot-password" &&
    activeScreen !== "reset-password"
  ) {
    return <LoginPage />;
  }

  // Render auth/setup screens directly without app shell
  if (activeScreen === "login") {
    return (
      <>
        <LoginPage />
        {assistantLayer}
      </>
    );
  }

  if (activeScreen === "forgot-password") {
    return (
      <>
        <ForgotPasswordPage />
        {assistantLayer}
      </>
    );
  }

  if (activeScreen === "reset-password") {
    return (
      <>
        <ResetPasswordPage />
        {assistantLayer}
      </>
    );
  }

  // Workstation gate: an unactivated terminal shows the activation page
  // full-screen. The plans screen stays reachable so a fresh install can
  // buy a subscription and receive its activation code.
  if (
    licenseStatus === LicenseStatus.UNACTIVATED &&
    activeScreen !== "licensing-plans"
  ) {
    return (
      <>
        <ActivationPage />
        {assistantLayer}
      </>
    );
  }

  // Company setup — fiscal emitter onboarding. Rendered full-screen like the
  // activation page: it is an onboarding gate, not a workspace screen.
if (activeScreen === "company-setup") {
      return (
        <>
          <CompanySetupWizard />
          {assistantLayer}
        </>
      );
    }

    // Certificate setup - DIAN digital certificate for the self-managed
    // billing plan. Full-screen onboarding gate like company-setup.
    if (activeScreen === "certificate-setup") {
      return (
        <>
          <CertificateSetupPage />
          {assistantLayer}
        </>
      );
    }

  // Render-time backstop for the route guard: while the redirect effect has
  // not landed yet, keep the unauthorized page unmounted and show the shell
  // with a neutral notice instead.
  if (session && !canAccessScreen(session, activeScreen)) {
    return (
      <AppShell
        cashierName={session.fullName}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex flex-1 flex-col items-center justify-center gap-pos-md px-6 text-center">
            <p
              className="text-body-sm"
              style={{ color: "var(--color-ink-muted)" }}
              role="status"
            >
              {t("access.screen_not_allowed")}
            </p>
            {/* Escape hatch for sessions whose role is unknown to the client
                hierarchy — otherwise the notice would trap the user forever. */}
            <button
              type="button"
              className="pos-button pos-button-secondary"
              onClick={() => useLocalSessionStore.getState().clearSession()}
            >
              {t("access.close_session")}
            </button>
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "user-management") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <UserManagementPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "audit-log") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <AuditLogView />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "license-status") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <LicenseStatusPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "licensing-plans") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <LicensingPlansPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "printing") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <PrintingContainer />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "printers") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <PrintersPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "print-queue") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <PrintQueuePage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "setup-wizard") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <SetupWizardPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "offline-sessions") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <SessionView />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  if (activeScreen === "local-network") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <OfflineModeBanner />
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <LocalNetworkPage />
          </div>
        </div>
        <PendingBlessingModal />
        {assistantLayer}
      </AppShell>
    );
  }

  return (
    <AppShell
      cashierName={session!.fullName}
      initialSyncState={isOnline ? "online" : "offline"}
    >
      <OfflineModeBanner />

      <div className="flex h-full">
        <NavigationSidebar />

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false} custom={navDirection}>
            {activeScreen === "home" && (
              <motion.div
                key="home"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <Home />
              </motion.div>
            )}

            {activeScreen === "sales" && (
              <motion.div
                key="sales"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                {shiftLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
                      Cargando...
                    </p>
                  </div>
                ) : !hasActiveShift ? (
                  <ShiftRequiredOverlay />
                ) : (
                  <SalesTransaction />
                )}
              </motion.div>
            )}

            {activeScreen === "payment" && (
              <motion.div
                key="payment"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <PaymentProcessing />
              </motion.div>
            )}

            {activeScreen === "receipt" && (
              <motion.div
                key="receipt"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <Receipt />
              </motion.div>
            )}

            {activeScreen === "cash-shift" && (
              <motion.div
                key="cash-shift"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <CashShiftPage />
              </motion.div>
            )}

            {activeScreen === "clients" && (
              <motion.div
                key="clients"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <ClientsPage />
              </motion.div>
            )}

            {activeScreen === "returns" && (
              <motion.div
                key="returns"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <ReturnsPage />
              </motion.div>
            )}

            {activeScreen === "inventory-adjustments" && (
              <motion.div
                key="inventory-adjustments"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <InventoryAdjustmentsPage />
              </motion.div>
            )}

            {activeScreen === "inventory-lots" && (
              <motion.div
                key="inventory-lots"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <InventoryLotsPage />
              </motion.div>
            )}

            {activeScreen === "inventory-count" && (
              <motion.div
                key="inventory-count"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <InventoryCountPage />
              </motion.div>
            )}

            {activeScreen === "productos-main" && (
              <motion.div
                key="productos-main"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <ProductosMainPage />
              </motion.div>
            )}

            {activeScreen === "purchases-main" && (
              <motion.div
                key="purchases-main"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <PurchasesMainPage />
              </motion.div>
            )}

            {activeScreen === "suppliers" && (
              <motion.div
                key="suppliers"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <SuppliersPage />
              </motion.div>
            )}

            {activeScreen === "purchase-orders" && (
              <motion.div
                key="purchase-orders"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <PurchaseOrdersPage />
              </motion.div>
            )}

            {activeScreen === "purchase-receptions" && (
              <motion.div
                key="purchase-receptions"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <PurchaseReceptionsPage />
              </motion.div>
            )}

            {activeScreen === "supplier-returns" && (
              <motion.div
                key="supplier-returns"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <SupplierReturnsPage />
              </motion.div>
            )}

            {activeScreen === "reports" && (
              <motion.div
                key="reports"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <ReportsPage />
              </motion.div>
            )}

            {activeScreen === "products" && (
              <motion.div
                key="products"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <ProductsPage />
              </motion.div>
            )}

            {activeScreen === "prescriptions" && (
              <motion.div
                key="prescriptions"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <PrescriptionsPage />
              </motion.div>
            )}

            {activeScreen === "admin-menu" && (
              <motion.div
                key="admin-menu"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <TenantConfigPage />
              </motion.div>
            )}

            {activeScreen === "fiscal" && (
              <motion.div
                key="fiscal"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <FiscalPage />
              </motion.div>
            )}

            {activeScreen === "sales-history" && (
              <motion.div
                key="sales-history"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <SalesHistoryPage />
              </motion.div>
            )}

            {activeScreen === "sync-health" && (
              <motion.div
                key="sync-health"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <SyncHealthPage />
              </motion.div>
            )}

            {activeScreen === "recovery" && (
              <motion.div
                key="recovery"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <RecoveryPage />
              </motion.div>
            )}

            {activeScreen === "about" && (
              <motion.div
                key="about"
                className="h-full"
                variants={variants}
                custom={navDirection}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: shouldReduceMotion ? 0.01 : SCREEN_TRANSITION_DURATION_S,
                  ease: "easeInOut",
                }}
              >
                <AboutPage />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Overlay components: update-check interceptor renders toasts/modals */}
      <UpdateCheckInterceptor />

      {/* Offline blessing modal — auto-manages visibility */}
      <PendingBlessingModal />

      {/* Assistant overlays: command palette, suggestions, help, shortcuts */}
      {assistantLayer}
    </AppShell>
  );
};

// ---------------------------------------------------------------------------
// App — entry point, wraps InnerApp with the database & services provider
// ---------------------------------------------------------------------------

export const App: FC = () => {
  if (DB_PROOF_ENABLED) {
    console.log("DB_PROOF_ENABLED is true, rendering DatabaseProof component instead of the full app.");
    return <DatabaseProof />;
  }

  console.log("DB_PROOF_ENABLED is false, rendering the full app.");
  return (
    <ServiceProvider>
      <ErrorBoundary>
        <InnerApp />
      </ErrorBoundary>
      <Toaster position="bottom-right" />
    </ServiceProvider>
  );
};


