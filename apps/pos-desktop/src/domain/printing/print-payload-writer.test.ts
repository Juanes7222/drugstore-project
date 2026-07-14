/**
 * Tests for the print payload writer.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { writePrintPayload } from "./print-payload-writer";

// Mock Tauri invoke — by default reject so we test the fallback path
const mockInvoke = vi.fn().mockRejectedValue(new Error("No Tauri"));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("writePrintPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a blob URL when Tauri is not available", async () => {
    const path = await writePrintPayload("receipt.html", "<html>Receipt</html>");

    expect(path).toMatch(/^blob:/);
  });

  it("returns a file path when Tauri invoke succeeds", async () => {
    mockInvoke.mockResolvedValueOnce("/tmp/print-queue/receipt.html");

    const path = await writePrintPayload("receipt.html", "<html>Receipt</html>");

    expect(path).toBe("/tmp/print-queue/receipt.html");
    expect(mockInvoke).toHaveBeenCalledWith("write_temp_file", {
      filename: "receipt.html",
      content: "<html>Receipt</html>",
    });
  });

  it("handles special characters in content", async () => {
    const path = await writePrintPayload("test.html", "ñññ áéíóú");

    expect(path).toMatch(/^blob:/);
  });
});
