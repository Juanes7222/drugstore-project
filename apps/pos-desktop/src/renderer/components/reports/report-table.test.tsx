/**
 * ReportTable — badge column rendering.
 *
 * BADGE columns that carry a `badgeKeyPrefix` resolve their raw enum
 * value through i18n (`${prefix}.${value}`); columns without a prefix
 * (or with a missing key) fall back to the raw text.  This pins the
 * contract the catalog uses for movement types, stock status, and
 * margin status.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportTable } from "./report-table";
import type { ReportDefinition } from "../../../domain/reports/report-types";

const badgeDef = {
  columns: [
    {
      id: "movementType",
      titleKey: "reports.cols.movement_type",
      type: "badge",
      align: "center",
      badgeKeyPrefix: "reports.movement_types",
    },
  ],
} as unknown as ReportDefinition;

const plainDef = {
  columns: [
    {
      id: "movementType",
      titleKey: "reports.cols.movement_type",
      type: "badge",
      align: "center",
    },
  ],
} as unknown as ReportDefinition;

describe("ReportTable badge rendering", () => {
  it("translates badge values through the column badgeKeyPrefix", () => {
    render(
      <ReportTable
        definition={badgeDef}
        rows={[{ movementType: "SALE" }]}
        total={1}
        chartFilter={null}
      />,
    );

    expect(screen.getByText("Venta")).toBeInTheDocument();
    expect(screen.queryByText("SALE")).not.toBeInTheDocument();
  });

  it("falls back to the raw value when the translation key is missing", () => {
    render(
      <ReportTable
        definition={badgeDef}
        rows={[{ movementType: "UNKNOWN_TYPE" }]}
        total={1}
        chartFilter={null}
      />,
    );

    expect(screen.getByText("UNKNOWN_TYPE")).toBeInTheDocument();
  });

  it("renders raw text when the column has no badgeKeyPrefix", () => {
    render(
      <ReportTable
        definition={plainDef}
        rows={[{ movementType: "SALE" }]}
        total={1}
        chartFilter={null}
      />,
    );

    expect(screen.getByText("SALE")).toBeInTheDocument();
  });
});
