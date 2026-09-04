/**
 * Tests for LocalSyncService.pullFromHub — the pull cursor passthrough.
 *
 * The TypeScript relay engine persists the pull cursor per hub address and
 * hands it back here; the service must forward it verbatim as `{ since }`
 * so the Rust client can resume from the right buffer position.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock for Tauri invoke — must be defined before vi.mock is hoisted
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => (mockInvoke as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { createLocalSyncService } from "./local-sync.service";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createLocalSyncService — pullFromHub", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("forwards the given cursor as { since }", async () => {
    mockInvoke.mockResolvedValue({ operations: [], nextSince: "2026-02-02T00:00:00.000Z" });
    const service = createLocalSyncService();

    await service.pullFromHub("2026-02-01T00:00:00.000Z");

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("pull_from_hub", { since: "2026-02-01T00:00:00.000Z" });
  });

  it("sends since null when no cursor is provided", async () => {
    mockInvoke.mockResolvedValue({ operations: [], nextSince: "2026-02-02T00:00:00.000Z" });
    const service = createLocalSyncService();

    await service.pullFromHub();

    expect(mockInvoke).toHaveBeenCalledWith("pull_from_hub", { since: null });
  });

  it("returns the hub operations and next cursor untouched", async () => {
    const response = {
      operations: [
        {
          operationUuid: "uuid-1",
          operationType: "SALE_CONFIRMATION",
          payload: "{}",
          payloadHash: "hash-1",
          sourceWorkstationId: "ws-2",
          sourceCreatedAt: "2026-01-15T12:00:00.000Z",
          retryCount: 0,
        },
      ],
      nextSince: "2026-02-02T00:00:00.000Z",
    };
    mockInvoke.mockResolvedValue(response);
    const service = createLocalSyncService();

    const result = await service.pullFromHub("2026-02-01T00:00:00.000Z");

    expect(result).toEqual(response);
  });
});
