/**
 * Report viewer — CASH_SHIFT_CLOSE "not ready" empty state.
 *
 * The page catches `ReportFiltersNotReadyException` and passes
 * `notReady` down.  The viewer must render the shift-picker hint
 * instead of the report when no response exists yet, keep showing a
 * previously generated response untouched, and render nothing
 * hint-like in the normal state.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ReportCode } from "../../../domain/reports/report-types";
import type { ReportResponse } from "../../../domain/reports/report-types";
import { ReportViewer } from "./report-viewer";
import { createFormatters } from "./use-reports-locale";
import es from "../../i18n/locales/es.json";
import en from "../../i18n/locales/en.json";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const storeState = vi.hoisted(() => ({
  // Literal: vi.hoisted runs before module imports, so ReportCode is
  // not reachable here; the cast is compile-time only.
  activeReportCode: "CASH_SHIFT_CLOSE" as ReportCode | null,
  lastResponse: null as ReportResponse | null,
  appliedFilters: null as unknown,
  chartFilter: null as { columnId: string; value: string | number } | null,
  setAppliedFilters: vi.fn(),
  applyChartFilter: vi.fn(),
  clearChartFilter: vi.fn(),
}));

vi.mock("../../stores/reports.store", () => ({
  useReportsUiStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (state: { session: null }) => unknown) =>
    selector({ session: null }),
  hasMinRole: () => true,
}));

// Stable services object so the viewer's shift-loading effect does not
// re-run on every render (a fresh object per render would re-trigger it).
const mockServices = vi.hoisted(() => ({
  reportExecutionService: { run: vi.fn() },
  cashShiftService: { getShiftHistory: vi.fn() },
}));

const getShiftHistoryMock = mockServices.cashShiftService.getShiftHistory;

vi.mock("../common/service-context", () => ({
  useServiceContext: () => mockServices,
}));

// Presentational children are not under test here — only the not-ready
// branch and the report body presence matter. ReportFilters keeps the
// shiftOptions/shiftsLoading props visible so the CASH_SHIFT_CLOSE
// option-mapping tests can assert on rendered option rows.
vi.mock("./report-header", () => ({ ReportHeader: () => <div>header-stub</div> }));
vi.mock("./report-filters", () => ({
  ReportFilters: (props: {
    shiftOptions: Array<{
      id: string;
      label: string;
      stateLabel: string;
      forced: boolean;
    }>;
    shiftsLoading: boolean;
  }) => (
    <div>
      <span>filters-stub</span>
      {props.shiftOptions.map((option) => (
        <span key={option.id}>
          {`${option.label}|${option.stateLabel}|${option.forced ? "forced" : "normal"}`}
        </span>
      ))}
      {props.shiftsLoading ? <span>shifts-loading</span> : null}
    </div>
  ),
}));
vi.mock("./report-table", () => ({ ReportTable: () => <div>table-stub</div> }));
vi.mock("./report-export-actions", () => ({
  ReportExportActions: () => <div>export-stub</div>,
}));
vi.mock("./charts/report-chart", () => ({ ReportChart: () => <div>chart-stub</div> }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const selectShiftTitle = "Seleccione un turno";
const selectShiftHint = "Elija el turno a cerrar para generar el documento de cierre.";

const lastResponseFixture = (): ReportResponse => ({
  code: ReportCode.CASH_SHIFT_CLOSE,
  generatedAt: "2026-07-31T10:00:00.000Z",
  freshness: {
    dataSource: "local-workstation",
    generatedAt: "2026-07-31T10:00:00.000Z",
    lastSyncAt: null,
    pendingOperations: 0,
    permanentFailures: 0,
    lastSyncSuccessful: true,
    dbRevision: "0",
  },
  warnings: [],
  executionMs: 12,
  fromCache: false,
  filters: {
    preset: "custom",
    dateFrom: "2026-07-31",
    dateTo: "2026-07-31",
    comparePrevious: false,
  },
  kpis: [],
  chart: { kind: "none", series: [] },
  rows: [],
  total: 0,
  offset: 0,
  limit: 50,
});

const shiftRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "shift-1",
  workstationId: "ws-1",
  userId: "user-1",
  state: "CLOSED",
  openedAt: new Date("2026-07-01T08:00:00Z"),
  closedAt: new Date("2026-07-01T17:30:00Z"),
  ...overrides,
});

// The viewer formats option labels with createFormatters(i18n.language);
// the i18n singleton defaults to "es" (see vitest.setup.ts).
const dateTimeEs = createFormatters("es").dateTime;

const shiftOptionRow = (option: {
  label: string;
  stateLabel: string;
  forced: boolean;
}) => `${option.label}|${option.stateLabel}|${option.forced ? "forced" : "normal"}`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ReportViewer", () => {
  beforeEach(() => {
    // Default: a never-settling history request so the existing not-ready
    // tests never receive a shift-options update after unmount.
    getShiftHistoryMock.mockReset();
    getShiftHistoryMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    storeState.lastResponse = null;
    storeState.appliedFilters = null;
  });

  describe("not-ready state", () => {
    it("shows the shift-picker hint when notReady is true and no response exists", () => {
      render(<ReportViewer onExecute={vi.fn()} isLoading={false} notReady />);

      expect(
        screen.getByRole("heading", { name: selectShiftTitle }),
      ).toBeVisible();
      expect(screen.getByText(selectShiftHint)).toBeVisible();
    });

    it("does not show the hint when notReady is false", () => {
      render(<ReportViewer onExecute={vi.fn()} isLoading={false} />);

      expect(
        screen.queryByRole("heading", { name: selectShiftTitle }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(selectShiftHint)).not.toBeInTheDocument();
    });

    it("keeps showing the previous response when notReady is true but a response exists", () => {
      storeState.lastResponse = lastResponseFixture();

      render(<ReportViewer onExecute={vi.fn()} isLoading={false} notReady />);

      expect(screen.queryByText(selectShiftHint)).not.toBeInTheDocument();
      expect(screen.getByText("table-stub")).toBeInTheDocument();
    });
  });

  describe("shift options for CASH_SHIFT_CLOSE", () => {
    it("loads shift history with limit 50 and maps only CLOSED shifts to options", async () => {
      const closedShift = shiftRecord();
      const openShift = shiftRecord({
        id: "shift-open",
        state: "OPEN",
        closedAt: null,
        openedAt: new Date("2026-07-02T08:00:00Z"),
      });
      getShiftHistoryMock.mockResolvedValue({
        shifts: [openShift, closedShift],
        total: 2,
      });

      render(<ReportViewer onExecute={vi.fn()} isLoading={false} />);

      expect(getShiftHistoryMock).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
      });
      const closedLabel = `${dateTimeEs.format(closedShift.openedAt)} - ${dateTimeEs.format(closedShift.closedAt)}`;
      expect(
        await screen.findByText(
          shiftOptionRow({
            label: closedLabel,
            stateLabel: es.cash_shift.state_closed,
            forced: false,
          }),
        ),
      ).toBeVisible();
      expect(
        screen.queryByText(dateTimeEs.format(openShift.openedAt)),
      ).not.toBeInTheDocument();
    });

    it("maps FORCED_CLOSE shifts with the forced-close label and forced flag", async () => {
      const forcedShift = shiftRecord({ state: "FORCED_CLOSE" });
      getShiftHistoryMock.mockResolvedValue({
        shifts: [forcedShift],
        total: 1,
      });

      render(<ReportViewer onExecute={vi.fn()} isLoading={false} />);

      const label = `${dateTimeEs.format(forcedShift.openedAt)} - ${dateTimeEs.format(forcedShift.closedAt)}`;
      expect(
        await screen.findByText(
          shiftOptionRow({
            label,
            stateLabel: es.cash_shift.state_forced_close,
            forced: true,
          }),
        ),
      ).toBeVisible();
    });

    it("keeps the loading flag on the filters while the history request is pending", async () => {
      let resolveHistory: (value: { shifts: unknown[]; total: number }) => void =
        () => {};
      const pending = new Promise<{ shifts: unknown[]; total: number }>(
        (resolve) => {
          resolveHistory = resolve;
        },
      );
      getShiftHistoryMock.mockReturnValue(pending);

      render(<ReportViewer onExecute={vi.fn()} isLoading={false} />);

      expect(screen.getByText("shifts-loading")).toBeVisible();

      await act(async () => {
        resolveHistory({ shifts: [], total: 0 });
        await pending;
      });

      expect(screen.queryByText("shifts-loading")).not.toBeInTheDocument();
    });

    it("resolves to empty options without crashing when the history request fails", async () => {
      getShiftHistoryMock.mockRejectedValue(new Error("offline"));

      render(<ReportViewer onExecute={vi.fn()} isLoading={false} />);

      expect(getShiftHistoryMock).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
      });
      await waitFor(() =>
        expect(screen.queryByText("shifts-loading")).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByText(
          new RegExp(`\\|${es.cash_shift.state_closed}\\|`),
        ),
      ).not.toBeInTheDocument();
      expect(screen.getByText("filters-stub")).toBeInTheDocument();
    });
  });

  describe("i18n contract for the not-ready hint", () => {
    it("translates reports.filters.select_shift in both locales", () => {
      expect(typeof es.reports.filters.select_shift).toBe("string");
      expect(es.reports.filters.select_shift.length).toBeGreaterThan(0);
      expect(typeof en.reports.filters.select_shift).toBe("string");
      expect(en.reports.filters.select_shift.length).toBeGreaterThan(0);
    });

    it("translates reports.filters.select_shift_hint in both locales", () => {
      expect(typeof es.reports.filters.select_shift_hint).toBe("string");
      expect(es.reports.filters.select_shift_hint.length).toBeGreaterThan(0);
      expect(typeof en.reports.filters.select_shift_hint).toBe("string");
      expect(en.reports.filters.select_shift_hint.length).toBeGreaterThan(0);
    });
  });
});
