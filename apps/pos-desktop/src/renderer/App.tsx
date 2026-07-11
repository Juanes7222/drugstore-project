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
import { type FC } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
import { RecoveryPage } from "../domain/recovery/recovery.page";
import { LoginPage } from "@/components/auth/login.page";
import { ForgotPasswordPage } from "@/components/auth/forgot-password.page";
import { ResetPasswordPage } from "@/components/auth/reset-password.page";
import { UserManagementPage } from "@/components/auth/user-management.page";
import { AuditLogView } from "@/components/auth/audit-log-view";
import { ServiceProvider } from "./components/common/service-context";
import { useAppSelector } from "@/store/hooks";
import { selectActiveScreen } from "@/store/slices/ui-slice";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useLocalSessionStore } from "../domain/auth/local-session.store";
import { useTranslation } from "react-i18next";
import { DB_PROOF_ENABLED } from "@infra/config";

const SCREEN_TRANSITION_DURATION_S = 0.3;

// ---------------------------------------------------------------------------
// InnerApp — the actual screen router, rendered once ServiceProvider is ready
// ---------------------------------------------------------------------------

const InnerApp: FC = () => {
  const { t } = useTranslation();
  const activeScreen = useAppSelector(selectActiveScreen);
  const isOnline = useOnlineStatus();
  const shouldReduceMotion = useReducedMotion();

  // Live session data from the Zustand store (populated at login).
  // When there is no session yet we render a login fallback.
  const session = useLocalSessionStore((s) => s.session);

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
    return <LoginPage />;
  }

  if (activeScreen === "forgot-password") {
    return <ForgotPasswordPage />;
  }

  if (activeScreen === "reset-password") {
    return <ResetPasswordPage />;
  }

  if (activeScreen === "user-management") {
    return (
      <AppShell
        cashierName={session?.fullName || ""}
        openingBalanceCents={0}
        openedAt={new Date().toISOString()}
        initialSyncState={isOnline ? "online" : "offline"}
      >
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <UserManagementPage />
          </div>
        </div>
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
        <div className="flex h-full">
          <NavigationSidebar />
          <div className="flex-1 overflow-hidden">
            <AuditLogView />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      cashierName={session.fullName}
      openingBalanceCents={0}
      openedAt={new Date().toISOString()}
      initialSyncState={isOnline ? "online" : "offline"}
    >
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
          </AnimatePresence>
        </div>
      </div>
    </AppShell>
  );
};

// ---------------------------------------------------------------------------
// App — entry point, wraps InnerApp with the database & services provider
// ---------------------------------------------------------------------------

export const App: FC = () => {
  if (DB_PROOF_ENABLED) {
    return <DatabaseProof />;
  }

  return (
    <ServiceProvider>
      <InnerApp />
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
