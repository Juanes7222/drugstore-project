/**
 * CompanySetupGate — "configure your company to invoice" gate shown when the
 * fiscal emitter data is missing (`useCompanySetup().status ===
 * "needs-setup"`).
 *
 * Used at two entry points: a redirect right after license activation and a
 * gate at cash-shift opening. Renders as a centered card that can fill the
 * whole window (post-activation) or the content area of the app shell
 * (cash-shift gate).
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2Icon } from "@/components/ui/icons";

export interface CompanySetupGateProps {
  /** Opens the company setup wizard. */
  onConfigure: () => void;
  /** Optional secondary action — skips setup for now (e.g. back to home). */
  onLater?: () => void;
}

export const CompanySetupGate: FC<CompanySetupGateProps> = ({
  onConfigure,
  onLater,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full items-center justify-center p-pos-xl">
      <div
        className="mx-auto w-full max-w-md rounded-pos p-pos-xl text-center shadow-pos-panel"
        style={{
          backgroundColor: "var(--color-panel)",
          border:
            "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
        }}
      >
        {/* Company emblem — trust/brand teal, same treatment as the
            shift-required and role-gate overlays */}
        <div
          className="mx-auto mb-pos-lg flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
          }}
          aria-hidden="true"
        >
          <Building2Icon
            size={32}
            strokeWidth={1.5}
            style={{ color: "var(--color-pharma)" }}
          />
        </div>

        <h2 className="mb-pos-md text-heading font-semibold text-ink">
          {t("company_setup.gate.title")}
        </h2>

        <p className="mb-pos-xl text-body-sm leading-relaxed text-ink-muted">
          {t("company_setup.gate.description")}
        </p>

        <button
          type="button"
          className="pos-button pos-button-primary inline-flex w-full items-center justify-center py-pos-md text-ui font-bold"
          onClick={onConfigure}
        >
          {t("company_setup.gate.configure")}
        </button>

        {onLater && (
          <button
            type="button"
            className="mt-pos-sm w-full py-pos-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink"
            onClick={onLater}
          >
            {t("company_setup.gate.later")}
          </button>
        )}
      </div>
    </div>
  );
};
