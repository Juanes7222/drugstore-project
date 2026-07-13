/**
 * Tests for useElapsedTime hook.
 *
 * We render a small test component that calls the hook so we can
 * verify the formatted string.  Fake timers control Date.now() and
 * setInterval so the test is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useElapsedTime } from "./use-elapsed-time";

const NOW = new Date("2026-07-13T12:00:00.000Z").getTime();

function TestComponent({ openedAt, isRunning }: { openedAt: string; isRunning: boolean }) {
  const elapsed = useElapsedTime(openedAt, isRunning);
  return <div data-testid="elapsed">{elapsed}</div>;
}

describe("useElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "00:00" when openedAt is the current time', () => {
    render(<TestComponent openedAt={new Date(NOW).toISOString()} isRunning={true} />);

    expect(screen.getByTestId("elapsed")).toHaveTextContent("00:00");
  });

  it('renders "01:00" when openedAt was 1 hour ago', () => {
    const oneHourAgo = new Date(NOW - 3600_000).toISOString();

    render(<TestComponent openedAt={oneHourAgo} isRunning={true} />);

    expect(screen.getByTestId("elapsed")).toHaveTextContent("01:00");
  });

  it("does not advance the timer when isRunning is false", () => {
    const openedAt = new Date(NOW - 3600_000).toISOString();
    render(<TestComponent openedAt={openedAt} isRunning={false} />);

    expect(screen.getByTestId("elapsed")).toHaveTextContent("01:00");

    // Advance time by 5 minutes — should still show 01:00 since not running
    act(() => {
      vi.advanceTimersByTime(300_000);
    });

    expect(screen.getByTestId("elapsed")).toHaveTextContent("01:00");
  });

  it("advances one minute after the 60-second interval elapses", () => {
    const openedAt = new Date(NOW - 3600_000).toISOString();
    render(<TestComponent openedAt={openedAt} isRunning={true} />);

    expect(screen.getByTestId("elapsed")).toHaveTextContent("01:00");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId("elapsed")).toHaveTextContent("01:01");
  });
});
