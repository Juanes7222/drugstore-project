import { describe, expect, it } from "vitest";
import {
  SaleForReturnNotFoundException,
  SaleNotConfirmedForReturnException,
  ReturnQuantityExceedsSaleException,
  ReturnSaleItemNotFoundException,
  ReturnNotInDraftException,
  ReturnNotFoundException,
  ReturnStockReversalFailedException,
} from "./exceptions";

describe("SaleForReturnNotFoundException", () => {
  it("includes the sale id", () => {
    expect(new SaleForReturnNotFoundException("s-1").message).toContain("s-1");
  });
});

describe("SaleNotConfirmedForReturnException", () => {
  it("includes sale id and state", () => {
    const e = new SaleNotConfirmedForReturnException("s-1", "IN_PROGRESS");
    expect(e.message).toContain("s-1");
    expect(e.message).toContain("IN_PROGRESS");
  });
});

describe("ReturnQuantityExceedsSaleException", () => {
  it("includes sold and requested quantities", () => {
    const e = new ReturnQuantityExceedsSaleException("si-1", 5, 10);
    expect(e.message).toContain("5");
    expect(e.message).toContain("10");
  });
});

describe("ReturnSaleItemNotFoundException", () => {
  it("includes sale item and sale ids", () => {
    const e = new ReturnSaleItemNotFoundException("si-1", "s-1");
    expect(e.message).toContain("si-1");
    expect(e.message).toContain("s-1");
  });
});

describe("ReturnNotInDraftException", () => {
  it("includes return id and state", () => {
    const e = new ReturnNotInDraftException("r-1", "CONFIRMED");
    expect(e.message).toContain("r-1");
    expect(e.message).toContain("CONFIRMED");
  });
});

describe("ReturnNotFoundException", () => {
  it("includes the return id", () => {
    expect(new ReturnNotFoundException("r-1").message).toContain("r-1");
  });
});

describe("ReturnStockReversalFailedException", () => {
  it("includes the lot id and message", () => {
    const e = new ReturnStockReversalFailedException("lot-1", "race condition");
    expect(e.message).toContain("lot-1");
    expect(e.message).toContain("race condition");
  });
});
