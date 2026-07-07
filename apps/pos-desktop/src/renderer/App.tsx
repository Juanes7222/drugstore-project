/**
 * Root application component — Pharmacy POS Terminal.
 * Phase 1 renders only the design token reference page.
 * Future phases will add routing, screens, and the cash-shift frame.
 */
import { DesignTokens } from "./dev/design-tokens";

export const App: React.FC = () => {
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <DesignTokens />
    </div>
  );
};
