/**
 * Tests for the contingency Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useContingencyStore } from "./contingency.store";

describe("ContingencyStore", () => {
  beforeEach(() => {
    // Reset to initial state
    useContingencyStore.setState({
      active: false,
      activeEventId: null,
      triggerReason: null,
      startedAt: null,
      invoicesGenerated: 0,
      invoicesTransmitted: 0,
      invoicesExpired: 0,
    });
  });

  describe("initial state", () => {
    it("starts with active=false and zero counts", () => {
      const state = useContingencyStore.getState();
      expect(state.active).toBe(false);
      expect(state.activeEventId).toBeNull();
      expect(state.triggerReason).toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.invoicesGenerated).toBe(0);
      expect(state.invoicesTransmitted).toBe(0);
      expect(state.invoicesExpired).toBe(0);
    });
  });

  describe("enter", () => {
    it("sets active=true with the provided event data", () => {
      const startedAt = new Date("2026-06-15T10:00:00.000Z");
      useContingencyStore.getState().enter("event-1", "Network lost", startedAt);

      const state = useContingencyStore.getState();
      expect(state.active).toBe(true);
      expect(state.activeEventId).toBe("event-1");
      expect(state.triggerReason).toBe("Network lost");
      expect(state.startedAt).toBe("2026-06-15T10:00:00.000Z");
    });

    it("resets counts to zero on entry", async () => {
      // Set some counts first
      useContingencyStore.setState({
        invoicesGenerated: 10,
        invoicesTransmitted: 5,
        invoicesExpired: 2,
      });

      useContingencyStore.getState().enter("event-2", "Manual override", new Date());

      const state = useContingencyStore.getState();
      expect(state.invoicesGenerated).toBe(0);
      expect(state.invoicesTransmitted).toBe(0);
      expect(state.invoicesExpired).toBe(0);
    });

    it("converts Date to ISO string for startedAt", () => {
      const date = new Date("2026-07-01T14:30:00.000Z");
      useContingencyStore.getState().enter("event-3", "Reason", date);

      expect(useContingencyStore.getState().startedAt).toBe(
        "2026-07-01T14:30:00.000Z",
      );
    });
  });

  describe("exit", () => {
    it("resets to initial state", () => {
      // Enter first
      useContingencyStore.getState().enter("event-1", "Network lost", new Date());
      // Then exit
      useContingencyStore.getState().exit();

      const state = useContingencyStore.getState();
      expect(state.active).toBe(false);
      expect(state.activeEventId).toBeNull();
      expect(state.triggerReason).toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.invoicesGenerated).toBe(0);
      expect(state.invoicesTransmitted).toBe(0);
      expect(state.invoicesExpired).toBe(0);
    });

    it("is idempotent when called multiple times", () => {
      useContingencyStore.getState().exit();
      useContingencyStore.getState().exit();

      expect(useContingencyStore.getState().active).toBe(false);
    });
  });

  describe("updateCounts", () => {
    it("updates invoicesGenerated", () => {
      useContingencyStore.getState().updateCounts({ invoicesGenerated: 5 });

      const state = useContingencyStore.getState();
      expect(state.invoicesGenerated).toBe(5);
      expect(state.invoicesTransmitted).toBe(0);
      expect(state.invoicesExpired).toBe(0);
    });

    it("updates invoicesTransmitted", () => {
      useContingencyStore.getState().updateCounts({ invoicesTransmitted: 3 });

      expect(useContingencyStore.getState().invoicesTransmitted).toBe(3);
    });

    it("updates invoicesExpired", () => {
      useContingencyStore.getState().updateCounts({ invoicesExpired: 1 });

      expect(useContingencyStore.getState().invoicesExpired).toBe(1);
    });

    it("updates multiple counts in a single call", () => {
      useContingencyStore
        .getState()
        .updateCounts({ invoicesGenerated: 10, invoicesTransmitted: 7 });

      const state = useContingencyStore.getState();
      expect(state.invoicesGenerated).toBe(10);
      expect(state.invoicesTransmitted).toBe(7);
    });

    it("preserves existing counts when partial update", () => {
      useContingencyStore.setState({
        invoicesGenerated: 20,
        invoicesTransmitted: 15,
        invoicesExpired: 5,
      });

      useContingencyStore.getState().updateCounts({ invoicesGenerated: 25 });

      const state = useContingencyStore.getState();
      expect(state.invoicesGenerated).toBe(25);
      expect(state.invoicesTransmitted).toBe(15);
      expect(state.invoicesExpired).toBe(5);
    });

    it("does not modify other state fields", () => {
      useContingencyStore.getState().enter("event-1", "Test", new Date());

      useContingencyStore.getState().updateCounts({ invoicesGenerated: 3 });

      const state = useContingencyStore.getState();
      expect(state.active).toBe(true);
      expect(state.activeEventId).toBe("event-1");
      expect(state.triggerReason).toBe("Test");
    });
  });
});
