/**
 * Page-level wiring tests for ClientsPage: the import entry button is
 * role-gated through canImportEntity and the page re-runs its search when
 * the import wizard reports a successful run (onImported → doSearch).
 *
 * Heavy sibling components are stubbed; the import-dialog module is replaced
 * by a stub that fires onImported, keeping the real canImportEntity.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { type FC } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleType } from "@pharmacy/shared-types";
import { ClientsPage } from "./clients.page";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { StubImportDialog, currentRole } = vi.hoisted(() => {
  const StubImportDialog: FC<{
    open: boolean;
    onImported?: () => void;
  }> = ({ open, onImported }) =>
    open ? (
      <button type="button" onClick={() => onImported?.()}>
        stub-import-done
      </button>
    ) : null;
  return { StubImportDialog, currentRole: { value: undefined as RoleType | undefined } };
});

const mockClientsService = {
  search: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
  pullFromServer: vi.fn().mockResolvedValue(0),
};

vi.mock("../common/service-context", () => ({
  useClientsService: () => mockClientsService,
}));

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ session: { role: currentRole.value } }),
}));

vi.mock("../../hooks/use-resizable-width", () => ({
  useResizableWidth: () => ({
    width: 512,
    isResizing: false,
    handleProps: {},
  }),
}));

vi.mock("@/utils/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./client-form", () => ({
  ClientForm: () => <div data-testid="client-form" />,
}));

vi.mock("./client-table", () => ({
  ClientTable: () => <div data-testid="client-table" />,
}));

vi.mock("./client-detail-dialog", () => ({
  ClientDetailDialog: () => <div data-testid="client-detail-dialog" />,
}));

vi.mock("./delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => <div data-testid="delete-confirm-dialog" />,
}));

vi.mock("../data-import/import-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data-import/import-dialog")>();
  return { ...actual, ImportDialog: StubImportDialog };
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ClientsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole.value = RoleType.CASHIER;
    mockClientsService.search.mockResolvedValue([]);
    mockClientsService.pullFromServer.mockResolvedValue(0);
  });

  it("shows the import entry button for cashiers", async () => {
    render(<ClientsPage />);

    const importButton = await screen.findByRole("button", {
      name: /Importar CSV\/Excel/,
    });
    // The header enters with a motion opacity animation, so visibility is
    // asserted via presence + enabled state instead of computed style.
    expect(importButton).toBeInTheDocument();
    expect(importButton).not.toBeDisabled();
  });

  it("hides the import entry button for roles without permission", async () => {
    currentRole.value = RoleType.INVENTORY_ASSISTANT;
    render(<ClientsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("client-table")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Importar CSV\/Excel/ }),
    ).not.toBeInTheDocument();
  });

  it("re-runs the client search after a successful import", async () => {
    const user = userEvent.setup();
    render(<ClientsPage />);

    const importButton = await screen.findByRole("button", {
      name: /Importar CSV\/Excel/,
    });
    await user.click(importButton);

    // Mount triggers pullFromServer + an initial search.
    await waitFor(() => {
      expect(mockClientsService.search).toHaveBeenCalled();
    });
    const callsBeforeImport = mockClientsService.search.mock.calls.length;

    const done = screen.getByRole("button", { name: "stub-import-done" });
    await user.click(done);

    await waitFor(() => {
      expect(mockClientsService.search.mock.calls.length).toBeGreaterThan(
        callsBeforeImport,
      );
    });
  });
});