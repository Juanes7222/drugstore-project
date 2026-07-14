import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineChart } from "./timeline-chart";
import type { HealthTimelineBucket } from "../../../domain/sync/sync-metrics.service";

const mockBuckets: HealthTimelineBucket[] = [
  { id: "2026-07-14T08:00:00.000Z", completed: 10, nonCompleted: 2 },
  { id: "2026-07-14T09:00:00.000Z", completed: 5, nonCompleted: 1 },
  { id: "2026-07-14T10:00:00.000Z", completed: 0, nonCompleted: 0 },
  { id: "2026-07-14T11:00:00.000Z", completed: 8, nonCompleted: 0 },
  { id: "2026-07-14T12:00:00.000Z", completed: 3, nonCompleted: 3 },
];

describe("TimelineChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ───────────────────────────────────────────────────

  it("shows empty message when data is empty", () => {
    render(<TimelineChart data={[]} />);

    expect(
      screen.getByText("No timeline data available"),
    ).toBeInTheDocument();
  });

  it("does not render SVG when data is empty", () => {
    const { container } = render(<TimelineChart data={[]} />);

    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  // ── Render structure ──────────────────────────────────────────────

  it("renders the title", () => {
    render(<TimelineChart data={mockBuckets} />);

    expect(
      screen.getByText("Sync Timeline (24h)"),
    ).toBeInTheDocument();
  });

  it("renders an SVG element with chart data", () => {
    const { container } = render(
      <TimelineChart data={mockBuckets} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute(
      "aria-label",
      "Sync activity timeline chart",
    );
  });

  // ── Legend ─────────────────────────────────────────────────────────

  it("renders legend labels", () => {
    render(<TimelineChart data={mockBuckets} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  // ── Y-axis ────────────────────────────────────────────────────────

  it("renders y-axis labels based on max value", () => {
    render(<TimelineChart data={mockBuckets} />);

    // max value is 10 (from bucket 0: completed=10)
    // Y-axis fractions: 0, 0.25, 0.5, 0.75, 1 → 0, 3, 5, 8, 10
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  // ── X-axis labels ─────────────────────────────────────────────────

  it("renders x-axis labels for every 4th bucket", () => {
    render(<TimelineChart data={mockBuckets} />);

    // Buckets at index 0, 4 get labels (idx % 4 === 0)
    // Bucket 0: "2026-07-14T08:00:00.000Z" → length >= 13 → slice(11,16) = "08:00"
    // Bucket 4: "2026-07-14T12:00:00.000Z" → slice(11,16) = "12:00"
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
  });

  it("does not render x-axis labels for non-4th buckets", () => {
    render(<TimelineChart data={mockBuckets} />);

    // Bucket 1 (idx=1), 2 (idx=2), 3 (idx=3) should not have labels
    expect(screen.queryByText("09:00")).not.toBeInTheDocument();
    expect(screen.queryByText("10:00")).not.toBeInTheDocument();
    expect(screen.queryByText("11:00")).not.toBeInTheDocument();
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("handles single bucket", () => {
    const singleBucket: HealthTimelineBucket[] = [
      { id: "2026-07-14T08:00:00.000Z", completed: 5, nonCompleted: 1 },
    ];

    const { container } = render(
      <TimelineChart data={singleBucket} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // X-axis label at index 0
    expect(screen.getByText("08:00")).toBeInTheDocument();
  });

  it("handles all-zero buckets without crashing", () => {
    const zeroBuckets: HealthTimelineBucket[] = [
      { id: "2026-07-14T08:00:00.000Z", completed: 0, nonCompleted: 0 },
      { id: "2026-07-14T09:00:00.000Z", completed: 0, nonCompleted: 0 },
    ];

    const { container } = render(
      <TimelineChart data={zeroBuckets} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Y-axis has multiple "0" labels when maxValue rounds; just check SVG renders
    expect(svg).toBeInTheDocument();
  });

  it("uses short bucket id format when length < 13", () => {
    const shortIdBuckets: HealthTimelineBucket[] = [
      { id: "08:00", completed: 5, nonCompleted: 1 },
      { id: "09:00", completed: 3, nonCompleted: 0 },
      { id: "10:00", completed: 1, nonCompleted: 1 },
      { id: "11:00", completed: 4, nonCompleted: 2 },
      { id: "12:00", completed: 0, nonCompleted: 0 },
    ];

    render(<TimelineChart data={shortIdBuckets} />);

    // idx=0 → "08:00" slice(0,5) = "08:00"
    // idx=4 → "12:00" slice(0,5) = "12:00"
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
  });

  it("renders green bars for completed and red bars for non-completed", () => {
    const { container } = render(
      <TimelineChart data={mockBuckets} />,
    );

    const greenRects = container.querySelectorAll("rect.fill-green-400");
    const redRects = container.querySelectorAll("rect.fill-red-400");

    // 5 buckets all have completed bars (green) + 1 green legend rect = 6
    expect(greenRects.length).toBe(6);
    // 3 buckets have nonCompleted > 0 (indices 0, 1, 4) + 1 red legend rect = 4
    expect(redRects.length).toBe(4);
  });

  it("renders a completed bar rect for each bucket even when completed is 0", () => {
    const { container } = render(
      <TimelineChart data={mockBuckets} />,
    );

    // Every bucket renders a green rect (completed bar) even if height is 0
    // 5 buckets + 1 legend = 6 rects (excluding the legend one counted above)
    // The legend uses rect too, so total green rects = 5 bars + 1 legend = 6
    const allGreenRects = container.querySelectorAll("rect.fill-green-400");
    expect(allGreenRects.length).toBeGreaterThanOrEqual(5);
  });
});
