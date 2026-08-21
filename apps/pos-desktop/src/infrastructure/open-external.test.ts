import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { openExternalUrl } from "./open-external";

// ---------------------------------------------------------------------------
// Mock Tauri shell plugin
// ---------------------------------------------------------------------------

const mockShellOpen = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mockShellOpen,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("openExternalUrl", () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockShellOpen.mockReset();
    windowOpenSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when the shell plugin opens the URL", async () => {
    mockShellOpen.mockResolvedValue(undefined);

    const result = await openExternalUrl("https://checkout.wompi.co/pay/abc");

    expect(result).toBe(true);
    expect(mockShellOpen).toHaveBeenCalledWith(
      "https://checkout.wompi.co/pay/abc",
    );
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("falls back to window.open when the shell open rejects", async () => {
    mockShellOpen.mockRejectedValue(new Error("shell bridge unavailable"));

    const result = await openExternalUrl("https://checkout.wompi.co/pay/abc");

    expect(result).toBe(true);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://checkout.wompi.co/pay/abc",
      "_blank",
    );
  });

  it("falls back to window.open when the shell module cannot be imported", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/plugin-shell", () => ({}));
    const fresh = await import("./open-external");

    const result = await fresh.openExternalUrl("https://checkout.wompi.co/pay/abc");

    expect(result).toBe(true);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://checkout.wompi.co/pay/abc",
      "_blank",
    );
    vi.doUnmock("@tauri-apps/plugin-shell");
  });

  it("returns false when window.open returns null", async () => {
    mockShellOpen.mockRejectedValue(new Error("shell bridge unavailable"));
    windowOpenSpy.mockReturnValue(null);

    const result = await openExternalUrl("https://checkout.wompi.co/pay/abc");

    expect(result).toBe(false);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://checkout.wompi.co/pay/abc",
      "_blank",
    );
  });
});