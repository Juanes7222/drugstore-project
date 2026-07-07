/**
 * Root application component — Pharmacy POS Terminal.
 *
 * Phase 2 renders the Sales / Cart screen inside the persistent AppShell.
 * Routing and additional screens will be added in later phases.
 */
import { AppShell } from "@/components/common/app-shell";
import { SalesTransaction } from "@/components/SalesTransaction/sales-transaction";

// Mock active shift for Phase 2. This data will come from the cash-shift
// service once the backend integration is complete.
const ACTIVE_SHIFT = {
  cashierName: "María Gómez",
  openingBalanceCents: 200_000,
  openedAt: new Date().toISOString(),
};

export const App: React.FC = () => {
  return (
    <AppShell
      cashierName={ACTIVE_SHIFT.cashierName}
      openingBalanceCents={ACTIVE_SHIFT.openingBalanceCents}
      openedAt={ACTIVE_SHIFT.openedAt}
    >
      <SalesTransaction />
    </AppShell>
  );
};
