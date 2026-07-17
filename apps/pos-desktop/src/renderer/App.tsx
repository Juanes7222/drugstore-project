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
import { SalesTransaction } from "@/components/SalesTransaction/sales-transaction";
import { PaymentProcessing } from "@/components/PaymentProcessing/payment-processing";
import { Receipt } from "@/components/Receipt/receipt";
import { NavigationSidebar } from "@/components/Navigation/navigation-sidebar";
import { ReturnsPage } from "@/components/returns/returns.page";
import { InventoryAdjustmentsPage } from "@/components/inventory-adjustments/inventory-adjustments.page";
import { PrescriptionsPage } from "@/components/prescriptions/prescriptions.page";
import { SyncHealthPage } from "@/components/sync/sync-health.page";
import { RecoveryPage } from "@/components/recovery/recovery.page";
import { AboutPage } from "@/components/update/about.page";
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

  // Start the sync scheduler once we have a valid authenticated session.
  // Created in initializeServices() without a token (first launch), then
  // wired up here so that seed data (products, lots, etc.) is pulled from
  // the server immediately after login.
  const svc = useServiceContext();
  const isSyncStarted = useRef(false);
  useEffect(() => {
    if (session?.accessToken && !isSyncStarted.current) {
      isSyncStarted.current = true;
      svc.syncScheduler.updateAccessToken(session.accessToken);
      svc.syncScheduler.start();
    }
  }, [session?.accessToken, svc]);

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
        openingBalanceCents={0}
        openedAt={new Date().toISOString()}
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
        openingBalanceCents={0}
        openedAt={new Date().toISOString()}
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

  if (activeScreen === "offline-sessions") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        openingBalanceCents={0}
        openedAt={new Date().toISOString()}
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

  return (
    <AppShell
      cashierName={session!.fullName}
      openingBalanceCents={0}
      openedAt={new Date().toISOString()}
      initialSyncState={isOnline ? "online" : "offline"}
    >
      <OfflineModeBanner />

      <div className="flex h-full">
        <NavigationSidebar />

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
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
                <SalesTransaction />
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
                <AdminPlaceholder />
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

// ---------------------------------------------------------------------------
// Admin placeholder (beyond Phase 5)
// ---------------------------------------------------------------------------

const AdminPlaceholder: FC = () => (
  <section
    aria-label="Admin menu"
    className="flex h-full flex-col items-center justify-center p-pos-md"
    style={{ backgroundColor: "var(--color-surface)" }}
  >
    <div className="pos-panel max-w-md p-pos-xl text-center">
      <h2
        className="text-heading font-bold"
        style={{ color: "var(--color-ink)" }}
      >
        Admin / Sync Status
      </h2>
      <p
        className="mt-pos-sm text-body"
        style={{
          color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
        }}
      >
        Admin configuration and sync status will be available in a future
        phase.
      </p>
    </div>
  </section>
);
