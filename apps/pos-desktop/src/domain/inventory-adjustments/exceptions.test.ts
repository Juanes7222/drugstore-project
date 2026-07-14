import { describe, expect, it } from "vitest";
import {
  AdjustmentNotFoundException,
  AdjustmentNotInDraftException,
  NoLotsForProductException,
  AdjustmentExceedsAvailableStockException,
  AdjustmentLotConflictException,
} from "./exceptions";

describe("AdjustmentNotFoundException", () => {
  it("includes the adjustment id", () => {
    expect(new AdjustmentNotFoundException("adj-1").message).toContain("adj-1");
  });
});

describe("AdjustmentNotInDraftException", () => {
  it("includes id and state", () => {
    const e = new AdjustmentNotInDraftException("adj-1", "APPLIED");
    expect(e.message).toContain("adj-1");
    expect(e.message).toContain("APPLIED");
  });
});

describe("NoLotsForProductException", () => {
  it("includes the product id", () => {
    expect(new NoLotsForProductException("p-001").message).toContain("p-001");
  });
});

describe("AdjustmentExceedsAvailableStockException", () => {
  it("includes requested and available", () => {
    const e = new AdjustmentExceedsAvailableStockException("p-001", 10, 5);
    expect(e.message).toContain("10");
    expect(e.message).toContain("5");
  });
});

describe("AdjustmentLotConflictException", () => {
  it("includes the lot id", () => {
    expect(new AdjustmentLotConflictException("lot-1").message).toContain("lot-1");
  });
});
