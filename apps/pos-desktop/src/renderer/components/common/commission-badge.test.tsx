/**
 * Component tests for CommissionBadge.
 *
 * Covers: hidden states (NONE / null type / non-positive value), the
 * PERCENTAGE and FIXED renderings, tooltip composition (rate, currency,
 * window bounds, status hint), and the validity-window styling
 * (solid vs. opacity-50). Window dates are computed relative to the
 * current moment so the tests never depend on the wall clock.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommissionType } from "@pharmacy/database/local";
import { CommissionBadge, hasCommissionConfig } from "./commission-badge";
import type { CommissionBadgeProps } from "./commission-badge";
import { formatCurrency } from "../../utils/format-currency";
import { formatShortDate } from "../../utils/format-date";

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const THIRTY_DAYS_AGO = daysFromNow(-30);
const THIRTY_DAYS_AHEAD = daysFromNow(30);

const renderBadge = (
  overrides: Partial<CommissionBadgeProps> = {},
) =>
  render(
    <CommissionBadge
      commissionType={CommissionType.PERCENTAGE}
      commissionValue={5}
      commissionStartsAt={null}
      commissionEndsAt={null}
      {...overrides}
    />,
  );

describe("CommissionBadge", () => {
  describe("hidden states", () => {
    it("renders nothing when the type is NONE even with a positive value", () => {
      renderBadge({
        commissionType: CommissionType.NONE,
        commissionValue: 5,
      });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });

    it("renders nothing when the type is null", () => {
      renderBadge({ commissionType: null, commissionValue: 5 });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });

    it("renders nothing when the type is undefined", () => {
      renderBadge({ commissionType: undefined });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });

    it("renders nothing when the value is zero", () => {
      renderBadge({ commissionValue: 0 });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });

    it("renders nothing when the value is negative", () => {
      renderBadge({ commissionValue: -2 });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });

    it("renders nothing when the value is null", () => {
      renderBadge({ commissionValue: null });

      expect(screen.queryByText("Comisión")).not.toBeInTheDocument();
    });
  });

  describe("visible states", () => {
    it("renders a commission badge span for PERCENTAGE", () => {
      renderBadge({ commissionType: CommissionType.PERCENTAGE });

      const badge = screen.getByText("Comisión");
      expect(badge.tagName).toBe("SPAN");
      expect(badge).toHaveClass("pos-badge", "pos-badge-commission");
      expect(badge).not.toHaveClass("opacity-50");
    });

    it("renders a commission badge span for FIXED", () => {
      renderBadge({
        commissionType: CommissionType.FIXED,
        commissionValue: 2_000,
      });

      expect(screen.getByText("Comisión")).toBeInTheDocument();
    });

    it("composes the tooltip as the percentage rate for PERCENTAGE", () => {
      renderBadge({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: "5",
      });

      const badge = screen.getByText("Comisión");
      expect(badge).toHaveAttribute("title", "5%");
      expect(badge).toHaveAccessibleName("5%");
    });

    it("composes the tooltip as the per-unit currency amount for FIXED", () => {
      const commissionValue = 2_000;
      renderBadge({
        commissionType: CommissionType.FIXED,
        commissionValue,
      });

      const expected = `${formatCurrency(
        Math.round(commissionValue * 100),
      )}/unidad`;
      const badge = screen.getByText("Comisión");
      expect(badge).toHaveAttribute("title", expected);
      expect(badge).toHaveAccessibleName(expected);
    });
  });

  describe("validity window", () => {
    it("is solid and omits window parts when no window is set", () => {
      renderBadge({ commissionStartsAt: null, commissionEndsAt: null });

      const badge = screen.getByText("Comisión");
      expect(badge).not.toHaveClass("opacity-50");
      expect(badge.getAttribute("title")).not.toContain("desde");
      expect(badge.getAttribute("title")).not.toContain("hasta");
      expect(badge.getAttribute("title")).not.toContain("fuera de vigencia");
    });

    it("is solid and includes both window parts when the window spans today", () => {
      renderBadge({
        commissionStartsAt: THIRTY_DAYS_AGO,
        commissionEndsAt: THIRTY_DAYS_AHEAD,
      });

      const badge = screen.getByText("Comisión");
      expect(badge).not.toHaveClass("opacity-50");
      expect(badge).toHaveAttribute(
        "title",
        `5% · desde ${formatShortDate(THIRTY_DAYS_AGO)} · hasta ${formatShortDate(THIRTY_DAYS_AHEAD)}`,
      );
      expect(badge.getAttribute("title")).not.toContain("fuera de vigencia");
    });

    it("is muted with the outside-window hint after the window expired", () => {
      renderBadge({ commissionEndsAt: THIRTY_DAYS_AGO });

      const badge = screen.getByText("Comisión");
      expect(badge).toHaveClass("opacity-50");
      expect(badge.getAttribute("title")).toContain(
        `hasta ${formatShortDate(THIRTY_DAYS_AGO)}`,
      );
      expect(badge.getAttribute("title")).toContain("fuera de vigencia");
    });

    it("is muted with the outside-window hint before the window starts", () => {
      renderBadge({ commissionStartsAt: THIRTY_DAYS_AHEAD });

      const badge = screen.getByText("Comisión");
      expect(badge).toHaveClass("opacity-50");
      expect(badge.getAttribute("title")).toContain(
        `desde ${formatShortDate(THIRTY_DAYS_AHEAD)}`,
      );
      expect(badge.getAttribute("title")).toContain("fuera de vigencia");
    });

    it("drops the from part when only the end is set", () => {
      renderBadge({ commissionEndsAt: THIRTY_DAYS_AHEAD });

      const badge = screen.getByText("Comisión");
      expect(badge.getAttribute("title")).not.toContain("desde");
      expect(badge.getAttribute("title")).toContain(
        `hasta ${formatShortDate(THIRTY_DAYS_AHEAD)}`,
      );
    });
  });
});

describe("hasCommissionConfig", () => {
  it("is true for PERCENTAGE with a positive value", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: "5",
      }),
    ).toBe(true);
  });

  it("is true for FIXED with a positive value", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.FIXED,
        commissionValue: 2_000,
      }),
    ).toBe(true);
  });

  it("is false for NONE", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.NONE,
        commissionValue: 5,
      }),
    ).toBe(false);
  });

  it("is false when the type is null", () => {
    expect(
      hasCommissionConfig({ commissionType: null, commissionValue: 5 }),
    ).toBe(false);
  });

  it("is false when the type is undefined", () => {
    expect(
      hasCommissionConfig({ commissionType: undefined, commissionValue: 5 }),
    ).toBe(false);
  });

  it("is false when the value is zero", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: 0,
      }),
    ).toBe(false);
  });

  it("is false when the value is negative", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: -1,
      }),
    ).toBe(false);
  });

  it("is false when the value is null", () => {
    expect(
      hasCommissionConfig({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: null,
      }),
    ).toBe(false);
  });
});
