/**
 * Root application component — Pharmacy POS Terminal.
 *
 * Renders the active screen inside the persistent AppShell and coordinates
 * the screen-to-screen motion handoff via the ui slice.
 *
 * NOTE: During the PGlite proof-of-concept phase, the DatabaseProof
 * component is rendered when VITE_DB_PROOF is set to "1".  This will be
 * removed once local-database integration is lifted into the real AppShell.
 */
import { type FC } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AppShell } from "@/components/common/app-shell";
import { DatabaseProof } from "@/components/DatabaseProof/database-proof";
import { SalesTransaction } from "@/components/SalesTransaction/sales-transaction";
import { PaymentProcessing } from "@/components/PaymentProcessing/payment-processing";
import { Receipt } from "@/components/Receipt/receipt";
import { useAppSelector } from "@/store/hooks";
import { selectActiveScreen } from "@/store/slices/ui-slice";
import { useOnlineStatus } from "@/hooks/use-online-status";

// Mock active shift for Phase 3. This data will come from the cash-shift
// service once the backend integration is complete.
const ACTIVE_SHIFT = {
  cashierName: "María Gómez",
  openingBalanceCents: 200_000,
  openedAt: new Date().toISOString(),
};

const SCREEN_TRANSITION_DURATION_S = 0.3;
const SHOW_DB_PROOF = import.meta.env.VITE_DB_PROOF === "1";

export const App: FC = () => {
  const activeScreen = useAppSelector(selectActiveScreen);
  const isOnline = useOnlineStatus();
  const shouldReduceMotion = useReducedMotion();

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

  if (SHOW_DB_PROOF) {
    return <DatabaseProof />;
  }

  return (
    <AppShell
      cashierName={ACTIVE_SHIFT.cashierName}
      openingBalanceCents={ACTIVE_SHIFT.openingBalanceCents}
      openedAt={ACTIVE_SHIFT.openedAt}
      initialSyncState={isOnline ? "online" : "offline"}
    >
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
      </AnimatePresence>
    </AppShell>
  );
};
