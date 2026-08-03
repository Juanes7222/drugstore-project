import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineChart } from "./timeline-chart";
import type { HealthTimelineBucket } from "../../../domain/sync/sync-metrics.service";

// ECharts renders an empty <svg> in jsdom, so chart internals are asserted
// on the option object passed to echarts-for-react instead.
const capturedOptions: Array<Record<string, any>> = [];

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: Record<string, any> }) => {
    capturedOptions.push(option);
    return <div data-testid="echarts-chart" />;
  },
}));

/** Last captured option, asserted to exist (chart was rendered). */
function lastOption(): Record<string, any> {
  const option = capturedOptions.at(-1);
  if (!option) {
    throw new Error("Expected the ECharts option to have been captured");
  }
  return option;
}

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
    capturedOptions.length = 0;
  });

  // ── Empty state ───────────────────────────────────────────────────

  it("shows empty message when data is empty", () => {
    render(<TimelineChart data={[]} />);

    expect(
      screen.getByText("Sin datos de actividad"),
    ).toBeInTheDocument();
  });

  it("does not render the chart when data is empty", () => {
    render(<TimelineChart data={[]} />);

    expect(
      screen.queryByTestId("echarts-chart"),
    ).not.toBeInTheDocument();
  });

  // ── Render structure ──────────────────────────────────────────────

  it("renders the title", () => {
    render(<TimelineChart data={mockBuckets} />);

    expect(
      screen.getByText("Actividad de sincronización (24h)"),
    ).toBeInTheDocument();
  });

  it("passes the chart data to ECharts", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.series).toHaveLength(2);
    expect(option.series[0].data).toEqual([10, 5, 0, 8, 3]);
    expect(option.series[1].data).toEqual([2, 1, 0, 0, 3]);
  });

  // ── Legend ────────────────────────────────────────────────────────

  it("renders legend labels", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.legend.data.map((d: any) => d.name)).toEqual([
      "Completadas",
      "Fallidas",
    ]);
  });

  // ── Axes ──────────────────────────────────────────────────────────

  it("builds x-axis labels from bucket hour boundaries", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.xAxis.data).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
    // Show every 4th label to avoid crowding
    expect(option.xAxis.axisLabel.interval).toBe(3);
  });

  it("configures the y-axis as a value axis", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.yAxis.type).toBe("value");
    expect(option.yAxis.minInterval).toBe(1);
  });

  // ── Bar series styling ────────────────────────────────────────────

  it("renders green bars for completed and red bars for non-completed", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.series[0].itemStyle.color).toBe("#0B6E6B");
    expect(option.series[1].itemStyle.color).toBe("#D32F2F");
  });

  it("keeps the completed series for every bucket even when completed is 0", () => {
    render(<TimelineChart data={mockBuckets} />);

    const option = lastOption();
    expect(option.series[0].data).toHaveLength(5);
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("handles a single bucket", () => {
    const singleBucket: HealthTimelineBucket[] = [
      { id: "2026-07-14T08:00:00.000Z", completed: 5, nonCompleted: 1 },
    ];

    render(<TimelineChart data={singleBucket} />);

    const option = lastOption();
    expect(option.xAxis.data).toEqual(["08:00"]);
    expect(option.series[0].data).toEqual([5]);
  });

  it("handles all-zero buckets without crashing", () => {
    const zeroBuckets: HealthTimelineBucket[] = [
      { id: "2026-07-14T08:00:00.000Z", completed: 0, nonCompleted: 0 },
      { id: "2026-07-14T09:00:00.000Z", completed: 0, nonCompleted: 0 },
    ];

    render(<TimelineChart data={zeroBuckets} />);

    const option = lastOption();
    expect(option.series[0].data).toEqual([0, 0]);
    expect(option.series[1].data).toEqual([0, 0]);
  });

  it("passes short bucket ids through as labels", () => {
    const shortIdBuckets: HealthTimelineBucket[] = [
      { id: "08:00", completed: 5, nonCompleted: 1 },
      { id: "09:00", completed: 3, nonCompleted: 0 },
      { id: "10:00", completed: 1, nonCompleted: 1 },
      { id: "11:00", completed: 4, nonCompleted: 2 },
      { id: "12:00", completed: 0, nonCompleted: 0 },
    ];

    render(<TimelineChart data={shortIdBuckets} />);

    const option = lastOption();
    expect(option.xAxis.data).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
  });
});
