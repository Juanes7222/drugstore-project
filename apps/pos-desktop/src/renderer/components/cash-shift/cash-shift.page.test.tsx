/**
 * Page tests for CashShiftPage — history load-more with keyset cursor.
 *
 * The page owns the cursor accumulation: the first page replaces the list,
 * subsequent pages are appended after the last loaded shift id, and the
 * "Load more" button disappears once history.length === total.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Prisma } from "@pharmacy/database/local";
import { ServiceContext } from "../common/service-context";
import type { Services } from "../common/service-context";
import { CashShiftPage } from "./cash-shift.page";
import { useCashShiftStore } from "../../../domain/cash-shift/cash-shift.store";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { useCompanySetupStore } from "../../../domain/company/company.store";
import type { CashShiftRecord } from "../../../domain/cash-shift/cash-shift.service";

// CashShiftPage mounts useCompanySetup, whose module chain imports pdfjs-dist;
// pdf.js canvas glue references DOMMatrix at module scope, which jsdom does
// not implement. Stub the extractor so the suite never loads pdf.js.
vi.mock("../../services/rut-pdf-extractor", () => ({
  extractRutPdfText: vi.fn(),
}));

// The page dispatches setActiveScreen from the company-setup gate; there is
// no Redux Provider in these tests, so stub the hooks.
vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => undefined,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const EMPTY_SUMMARY = {
  transactionCount: 0,
  totalSalesAmount: "0",
  openingBalance: "0",
  totalsByPaymentMethod: [],
};

function makeShift(index: number): CashShiftRecord {
  return {
    id: `shift-${String(index).padStart(4, "0")}`,
    workstationId: "ws-1",
    userId: "user-1",
    state: "CLOSED",
    openedAt: new Date(Date.UTC(2026, 6, 1, 8, index)),
    closedAt: new Date(Date.UTC(2026, 6, 1, 18, index)),
    closedByUserId: "user-1",
    openingBalance: new Prisma.Decimal("100000"),
    openingNotes: null,
    expectedClosingAmount: new Prisma.Decimal("0"),
    actualClosingAmount: new Prisma.Decimal("0"),
    closingDifference: new Prisma.Decimal("0"),
    closingNotes: null,
    forcedClose: false,
    hasExtendedAlert: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** The store-wide shift while it is still open — what the close wizard runs on. */
function makeOpenShift(): CashShiftRecord {
  return {
    ...makeShift(1),
    state: "OPEN",
    closedAt: null,
    closedByUserId: null,
  };
}

/** An ADMIN session: only admin-level roles may open or close the shift. */
function makeAdminSession() {
  return {
    userId: "user-1",
    username: "admin",
    fullName: "Administradora Principal",
    displayName: "Administradora Principal",
    role: "ADMIN",
    subscriptionId: "sub-1",
    workstationId: "ws-1",
    accessToken: "",
    refreshToken: "",
    sessionId: "session-1",
    sessionTrust: "SERVER_VERIFIED",
  };
}

interface RenderPageOptions {
  getShiftHistory: ReturnType<typeof vi.fn>;
  getShiftSalesSummary?: ReturnType<typeof vi.fn>;
}

function renderPage({ getShiftHistory, getShiftSalesSummary }: RenderPageOptions) {
  const cashShiftService = {
    getShiftHistory,
    hydrateStore: vi.fn(),
    openShift: vi.fn(),
    getShiftSalesSummary:
      getShiftSalesSummary ?? vi.fn().mockResolvedValue(EMPTY_SUMMARY),
    getShiftFiscalComparison: vi.fn().mockResolvedValue(null),
    closeWithCounts: vi.fn(),
  };

  render(
    <ServiceContext.Provider value={{ cashShiftService } as unknown as Services}>
      <CashShiftPage />
    </ServiceContext.Provider>,
  );
}

function makePages(total: number, firstSize: number, secondSize: number) {
  const first = Array.from({ length: firstSize }, (_, i) => makeShift(i));
  const second = Array.from({ length: secondSize }, (_, i) =>
    makeShift(firstSize + i),
  );
  return { first, second, total };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CashShiftPage history", () => {
  beforeEach(() => {
    useCashShiftStore.setState({ currentShift: null, isLoading: false });
    useLocalSessionStore.setState({ session: null });
    // The company-setup gate would replace the whole page when the fiscal
    // emitter data is missing; these history tests target the shift table,
    // so pre-mark the company as configured.
    useCompanySetupStore.setState({ status: "complete" });
  });

  it("loads the first page and appends the next page via keyset cursor", async () => {
    const { first, second, total } = makePages(35, PAGE_SIZE, 15);
    const getShiftHistory = vi
      .fn()
      .mockResolvedValueOnce({ shifts: first, total })
      .mockResolvedValueOnce({ shifts: second, total });

    renderPage({ getShiftHistory });

    // First page: 20 data rows + the header row.
    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1);
    });
    expect(screen.getByText(`${total} turno(s)`)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    // All 35 rows loaded → button disappears.
    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(total + 1);
    });
    expect(
      screen.queryByRole("button", { name: "Cargar más" }),
    ).not.toBeInTheDocument();

    // Second call used the last loaded shift as the keyset cursor.
    expect(getShiftHistory).toHaveBeenNthCalledWith(1, { limit: PAGE_SIZE });
    expect(getShiftHistory).toHaveBeenNthCalledWith(2, {
      limit: PAGE_SIZE,
      cursor: { id: first[first.length - 1].id },
    });
  });

  it("dedupes rows that overlap between pages", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => makeShift(i));
    // A shift was opened between fetches, so page 2 repeats the last row.
    const second = [
      first[first.length - 1],
      ...Array.from({ length: 14 }, (_, i) => makeShift(PAGE_SIZE + i)),
    ];
    const getShiftHistory = vi
      .fn()
      .mockResolvedValueOnce({ shifts: first, total: 35 })
      .mockResolvedValueOnce({ shifts: second, total: 35 });

    renderPage({ getShiftHistory });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    // 20 + 14 unique new rows + header (the duplicate is dropped).
    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(20 + 14 + 1);
    });
  });

  it("discards a stale load-more append when the shift changes mid-flight", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => makeShift(i));
    const freshFirst = [makeShift(1000)];

    let resolveLoadMore!: (value: {
      shifts: CashShiftRecord[];
      total: number;
    }) => void;
    const loadMoreDeferred = new Promise<{
      shifts: CashShiftRecord[];
      total: number;
    }>((resolve) => {
      resolveLoadMore = resolve;
    });

    const getShiftHistory = vi
      .fn()
      .mockResolvedValueOnce({ shifts: first, total: 30 })
      // The load-more request hangs while the cashier opens a shift.
      .mockImplementationOnce(() => loadMoreDeferred)
      .mockResolvedValue({ shifts: freshFirst, total: 1 });

    renderPage({ getShiftHistory });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    // A shift opens while the append is still in flight → first page reset.
    act(() => {
      useCashShiftStore.setState({ currentShift: makeShift(999) });
    });
    await waitFor(() => {
      expect(getShiftHistory).toHaveBeenCalledTimes(3);
    });

    // The stale append resolves after the reset and must be discarded.
    act(() => {
      resolveLoadMore({ shifts: [makeShift(2000)], total: 30 });
    });

    await waitFor(() => {
      // Only the fresh first page (1 row) + header — no stale contamination.
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
    expect(screen.queryByText("SHIFT-20")).not.toBeInTheDocument();
  });

  it("restarts from the first page when the shift state changes", async () => {
    const getShiftHistory = vi
      .fn()
      .mockResolvedValue({ shifts: [makeShift(0)], total: 1 });

    renderPage({ getShiftHistory });

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
    expect(getShiftHistory).toHaveBeenCalledTimes(1);

    // The cashier opens a shift → the page must restart the list, not
    // append on top of the previous cursor.
    act(() => {
      useCashShiftStore.setState({ currentShift: makeShift(999) });
    });

    await waitFor(() => {
      expect(getShiftHistory).toHaveBeenCalledTimes(2);
    });
    expect(getShiftHistory).toHaveBeenNthCalledWith(2, { limit: PAGE_SIZE });
  });
});

/**
 * The close wizard.
 *
 * Regression guard for a race the e2e suite hit on every close: the summary
 * is computed asynchronously, and the resolution used to OVERWRITE the step
 * the cashier was on. A cashier who advanced into the count step before the
 * totals arrived was pulled back to the summary — and the count step they
 * had reached was the empty one.
 */
describe("CashShiftPage close wizard", () => {
  beforeEach(() => {
    useCashShiftStore.setState({ currentShift: makeOpenShift(), isLoading: false });
    useLocalSessionStore.setState({ session: makeAdminSession() as never });
    useCompanySetupStore.setState({ status: "complete" });
  });

  it("waits for the shift summary instead of offering an empty one", async () => {
    let resolveSummary!: (value: typeof EMPTY_SUMMARY) => void;
    const getShiftSalesSummary = vi.fn().mockImplementation(
      () =>
        new Promise<typeof EMPTY_SUMMARY>((resolve) => {
          resolveSummary = resolve;
        }),
    );

    renderPage({
      getShiftHistory: vi.fn().mockResolvedValue({ shifts: [], total: 0 }),
      getShiftSalesSummary,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cerrar turno" }));

    // The totals are still being computed: there must be no "Siguiente" to
    // click, because it would take the cashier into a count step with no
    // numbers in it.
    expect(
      screen.queryByRole("button", { name: "Siguiente" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveSummary({
        transactionCount: 3,
        totalSalesAmount: "1500",
        openingBalance: "0",
        totalsByPaymentMethod: [],
      });
    });

    // The summary is ready → the wizard advances with the real numbers.
    expect(
      await screen.findByRole("button", { name: "Siguiente" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
