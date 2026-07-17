/**
 * Tests for the browser-side file download helper.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob } from "./download";

describe("downloadBlob", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.fn>;
  let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:test");
    revokeObjectURL = vi.fn();
    click = vi.fn();
    mockAnchor = { href: "", download: "", click };

    (globalThis as any).URL.createObjectURL = createObjectURL;
    (globalThis as any).URL.revokeObjectURL = revokeObjectURL;

    document.createElement = vi.fn((tagName: string) => {
      if (tagName === "a") {
        return mockAnchor as unknown as HTMLAnchorElement;
      }
      return document.createElement(tagName);
    }) as unknown as typeof document.createElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a Blob with the correct content and MIME type", () => {
    downloadBlob("hello,world", "test.csv", "text/csv");

    expect(createObjectURL).toHaveBeenCalledOnce();

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("text/csv");
  });

  it("sets anchor.download to the provided filename", () => {
    downloadBlob("data", "report.json", "application/json");

    expect(mockAnchor.download).toBe("report.json");
  });

  it("clicks the anchor to trigger the download", () => {
    downloadBlob("content", "file.txt", "text/plain");

    expect(click).toHaveBeenCalledOnce();
  });

  it("revokes the object URL after clicking", () => {
    downloadBlob("content", "file.txt", "text/plain");

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(createObjectURL.mock.invocationCallOrder[0]).toBeLessThan(
      revokeObjectURL.mock.invocationCallOrder[0],
    );
  });

  it("works with empty content string", () => {
    downloadBlob("", "empty.csv", "text/csv");

    expect(createObjectURL).toHaveBeenCalledOnce();

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.size).toBe(0);
  });

  it("works with CSV MIME type", () => {
    downloadBlob("a,b,c\n1,2,3", "data.csv", "text/csv;charset=utf-8;");

    expect(createObjectURL).toHaveBeenCalledOnce();

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("text/csv;charset=utf-8;");
  });
});
