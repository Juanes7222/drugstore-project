/**
 * Component tests for the Sync Health ActionBar.
 *
 * Covers every callback handler to ensure the component wires clicks
 * and checkbox changes to the props correctly.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionBar } from "./action-bar";
import type { ConnectionStatus } from "./sync-health.types";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeStatus(overrides: Partial<ConnectionStatus> = {}): ConnectionStatus {
  return { type: "unknown", ...overrides } as ConnectionStatus;
}

function renderBar(props: Partial<Parameters<typeof ActionBar>[0]> = {}) {
  const defaults = {
    connectionStatus: makeStatus(),
    onTestConnection: vi.fn(),
    onRunSyncNow: vi.fn(),
    onExportCsv: vi.fn(),
    onExportJson: vi.fn(),
    retryWithoutCheck: false,
    onRetryWithoutCheckChange: vi.fn(),
    showDiscarded: false,
    onShowDiscardedChange: vi.fn(),
  };

  const merged = { ...defaults, ...props };

  return {
    ...merged,
    ...render(<ActionBar {...merged} />),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActionBar", () => {
  it("calls onExportCsv when the Export CSV button is clicked", async () => {
    const onExportCsv = vi.fn();
    const { container } = renderBar({ onExportCsv });
    const user = userEvent.setup();

    // Find by visible text instead of testid
    const csvButton = screen.getByRole("button", { name: /export csv/i });
    await user.click(csvButton);

    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it("calls onExportJson when the Export JSON button is clicked", async () => {
    const onExportJson = vi.fn();
    renderBar({ onExportJson });
    const user = userEvent.setup();

    const jsonButton = screen.getByRole("button", { name: /export json/i });
    await user.click(jsonButton);

    expect(onExportJson).toHaveBeenCalledTimes(1);
  });

  it("calls onRetryWithoutCheckChange when the retry checkbox is toggled", async () => {
    const onRetryWithoutCheckChange = vi.fn();
    renderBar({ onRetryWithoutCheckChange });
    const user = userEvent.setup();

    const checkbox = screen.getByRole("checkbox", {
      name: /retry without server check/i,
    });
    await user.click(checkbox);

    expect(onRetryWithoutCheckChange).toHaveBeenCalledTimes(1);
    expect(onRetryWithoutCheckChange).toHaveBeenCalledWith(true);
  });

  it("calls onShowDiscardedChange when the show-discarded checkbox is toggled", async () => {
    const onShowDiscardedChange = vi.fn();
    renderBar({ onShowDiscardedChange });
    const user = userEvent.setup();

    const checkbox = screen.getByRole("checkbox", {
      name: /show discarded/i,
    });
    await user.click(checkbox);

    expect(onShowDiscardedChange).toHaveBeenCalledTimes(1);
    expect(onShowDiscardedChange).toHaveBeenCalledWith(true);
  });

  it("calls onTestConnection when the Test Connection button is clicked", async () => {
    const onTestConnection = vi.fn();
    renderBar({ onTestConnection });
    const user = userEvent.setup();

    const button = screen.getByRole("button", { name: /test connection/i });
    await user.click(button);

    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });

  it("calls onRunSyncNow when the Run Sync Now button is clicked", async () => {
    const onRunSyncNow = vi.fn();
    renderBar({ onRunSyncNow });
    const user = userEvent.setup();

    const button = screen.getByRole("button", { name: /run sync now/i });
    await user.click(button);

    expect(onRunSyncNow).toHaveBeenCalledTimes(1);
  });

  it("disables the test connection button while testing", () => {
    renderBar({
      connectionStatus: makeStatus({ type: "testing" }),
    });

    const button = screen.getByRole("button", { name: /test connection/i });
    expect(button).toBeDisabled();
  });

  it("renders the test connection button with reachable status styling", () => {
    renderBar({
      connectionStatus: makeStatus({ type: "reachable" }),
    });

    const button = screen.getByRole("button", { name: /test connection/i });
    expect(button).toBeInTheDocument();
    // The reachable status renders a green check icon — the exact
    // styling is hard to assert in jsdom, so we just verify presence.
    expect(button.querySelector("svg")).toBeInTheDocument();
  });
});
