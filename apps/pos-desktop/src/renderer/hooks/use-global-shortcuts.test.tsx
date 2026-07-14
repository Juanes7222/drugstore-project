/**
 * Tests for the useGlobalShortcuts hook.
 *
 * The hook registers a keyboard event listener on document. We simulate
 * keydown events and verify the correct handler callback is invoked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGlobalShortcuts, type ShortcutHandlers } from "./use-global-shortcuts";

const createHandlers = (): ShortcutHandlers => ({
  onOpenPalette: vi.fn(),
  onOpenHelp: vi.fn(),
  onShowCheatsheet: vi.fn(),
  onCloseOverlay: vi.fn(),
  onNewSale: vi.fn(),
  onSyncNow: vi.fn(),
  onContextHelp: vi.fn(),
});

function dispatchKey(key: string, options?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; target?: HTMLElement }) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: options?.metaKey ?? false,
    ctrlKey: options?.ctrlKey ?? false,
    shiftKey: options?.shiftKey ?? false,
    altKey: options?.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });

  // IME composition state is a KeyboardEvent property not in the KeyboardEventInit
  // interface — set it directly.
  if (options?.isComposing) {
    Object.defineProperty(event, "isComposing", { value: true });
  }

  if (options?.target) {
    Object.defineProperty(event, "target", { value: options.target });
  }

  document.dispatchEvent(event);
  return event;
}

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Always-active shortcuts ---

  it("triggers onOpenPalette on Cmd+K", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("k", { metaKey: true });
    expect(handlers.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("triggers onOpenPalette on Ctrl+K (Windows/Linux)", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("k", { ctrlKey: true });
    expect(handlers.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("triggers onCloseOverlay on Escape", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, true, "sales"));

    dispatchKey("Escape");
    expect(handlers.onCloseOverlay).toHaveBeenCalledTimes(1);
  });

  it("triggers onContextHelp on F1", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("F1");
    expect(handlers.onContextHelp).toHaveBeenCalledTimes(1);
  });

  // --- Shortcuts that do NOT fire in text inputs ---

  it("triggers onOpenHelp on Cmd+/ when not in an input", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("/", { metaKey: true });
    expect(handlers.onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger onOpenHelp on Cmd+/ when target is an input", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    const input = document.createElement("input");
    dispatchKey("/", { metaKey: true, target: input });
    expect(handlers.onOpenHelp).not.toHaveBeenCalled();
  });

  it("triggers onShowCheatsheet on ? alone (no modifiers)", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("?");
    expect(handlers.onShowCheatsheet).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger onShowCheatsheet when ? is pressed with meta", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("?", { metaKey: true });
    expect(handlers.onShowCheatsheet).not.toHaveBeenCalled();
  });

  // --- Context-aware shortcuts ---

  it("triggers onNewSale on Cmd+N on a sales screen", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("n", { metaKey: true });
    expect(handlers.onNewSale).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger onNewSale on Cmd+N when modal is open and screen is non-sale", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, true, "returns"));

    dispatchKey("n", { metaKey: true });
    expect(handlers.onNewSale).not.toHaveBeenCalled();
  });

  it("triggers onSyncNow on Cmd+Shift+S", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("s", { metaKey: true, shiftKey: true });
    expect(handlers.onSyncNow).toHaveBeenCalledTimes(1);
  });

  // --- IME composition ---

  it("skips shortcut handling when IME composition is active", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    dispatchKey("k", { metaKey: true, isComposing: true });
    expect(handlers.onOpenPalette).not.toHaveBeenCalled();
  });

  // --- Cleanup ---

  it("removes the event listener on unmount", () => {
    const handlers = createHandlers();
    const { unmount } = renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    unmount();

    dispatchKey("k", { metaKey: true });
    expect(handlers.onOpenPalette).not.toHaveBeenCalled();
  });

  // --- Guard clause: text input for input-restricted shortcuts ---

  it("does not fire input-restricted shortcuts in a textarea", () => {
    const handlers = createHandlers();
    renderHook(() => useGlobalShortcuts(handlers, false, "sales"));

    const textarea = document.createElement("textarea");
    dispatchKey("?", { target: textarea });
    expect(handlers.onShowCheatsheet).not.toHaveBeenCalled();
  });
});
