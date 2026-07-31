/**
 * Vitest setup — Pharmacy POS Terminal.
 *
 * Extends expect with Testing Library matchers and initializes the i18n
 * singleton so component tests render translated strings correctly.
 */
import "@testing-library/jest-dom/vitest";
import "@/i18n";

// cmdk (used by the shift picker and command palette) measures its list
// with ResizeObserver and scrolls selected items into view, neither of
// which jsdom implements. No-op stubs keep the portal list rendering.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
