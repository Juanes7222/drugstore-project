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
import { type FC, useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Toaster } from "sileo";
import { AppShell } from "@/components/common/app-shell";
import { DatabaseProof } from "@/components/DatabaseProof/database-proof";
import { Home } from "@/components/Home/home";
import { SalesTransaction } from "@/components/SalesTransaction/sales-transaction";
import { PaymentProcessing } from "@/components/PaymentProcessing/payment-processing";
import { Receipt } from "@/components/Receipt/receipt";
import { NavigationSidebar } from "@/components/Navigation/navigation-sidebar";
import { CashShiftPage } from "@/components/cash-shift/cash-shift.page";
import { ClientsPage } from "@/components/clients/clients.page";
import { FiscalPage } from "../domain/fiscal/fiscal.page";
import { ReturnsPage } from "@/components/returns/returns.page";
import { InventoryAdjustmentsPage } from "@/components/inventory-adjustments/inventory-adjustments.page";
import { InventoryLotsPage } from "@/components/inventory-lots/inventory-lots.page";
import { ProductsPage } from "@/components/products/products.page";
import { ProductosMainPage } from "@/components/productos/productos-main.page";
import { PurchasesMainPage } from "@/components/purchases/purchases-main.page";
import { SuppliersPage } from "@/components/purchases/suppliers.page";
import { PurchaseOrdersPage } from "@/components/purchases/purchase-orders.page";
import { PurchaseReceptionsPage } from "@/components/purchases/purchase-receptions.page";
import { SupplierReturnsPage } from "@/components/purchases/supplier-returns.page";
import { PrescriptionsPage } from "@/components/prescriptions/prescriptions.page";
import { SyncHealthPage } from "@/components/sync/sync-health.page";
import { LocalNetworkPage } from "@/components/local-sync/local-network.page";
import { RecoveryPage } from "@/components/recovery/recovery.page";
import { AboutPage } from "@/components/update/about.page";
import { LicenseStatusPage } from "@/components/licensing/license-status.page";
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
import { useAppSelector } from "@/store/hooks";
import { selectActiveScreen } from "@/store/slices/ui-slice";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRequireActiveShift } from "@/hooks/use-require-active-shift";
import { ShiftRequiredOverlay } from "@/components/common/shift-required-overlay";
import { useLocalSessionStore } from "../domain/auth/local-session.store";
import { DB_PROOF_ENABLED } from "@infra/config";

const SCREEN_TRANSITION_DURATION_S = 0.3;

// ---------------------------------------------------------------------------
// InnerApp — the actual screen router, rendered once ServiceProvider is ready
// ---------------------------------------------------------------------------

const InnerApp: FC = () => {
  const activeScreen = useAppSelector(selectActiveScreen);
  const isOnline = useOnlineStatus();
  const shouldReduceMotion = useReducedMotion();

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
  }, [session?.accessToken, session?.workstationId, svc]);

  const variants = {
    initial: shouldReduceMotion
      ? { opacity: 0 }
      : { opacity: 0, x: 24, scale: 0.99 },
    animate: shouldReduceMotion
      ? { opacity: 1 }
      : { opacity: 1, x: 0, scale: 1 },
    exit: shouldReduceMotion
      ? { opacity: 0 }
      : { opacity: 0, x: -24, scale: 0.99 },
  };

  if (!session && activeScreen !== "login" && activeScreen !== "forgot-password" && activeScreen !== "reset-password") {
    return <LoginPage />;
  }

  // Render login/forgot-password/reset-password directly without app shell
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
          <AnimatePresence mode="wait" initial={false}>
            {activeScreen === "home" && (
              <motion.div
                key="home"
                className="h-full"
                variants={variants}
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

            {activeScreen === "productos-main" && (
              <motion.div
                key="productos-main"
                className="h-full"
                variants={variants}
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

            {activeScreen === "products" && (
              <motion.div
                key="products"
                className="h-full"
                variants={variants}
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

            {activeScreen === "sync-health" && (
              <motion.div
                key="sync-health"
                className="h-full"
                variants={variants}
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


