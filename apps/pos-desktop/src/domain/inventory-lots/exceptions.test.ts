import { describe, expect, it } from "vitest";
import { InsufficientStockException, ConcurrentStockModificationException } from "./exceptions";

describe("InsufficientStockException", () => {
  it("includes product, requested and available quantities", () => {
    const e = new InsufficientStockException("p-001", 10, 3);
    expect(e.message).toContain("p-001");
    expect(e.message).toContain("10");
    expect(e.message).toContain("3");
  });
});

describe("ConcurrentStockModificationException", () => {
  it("includes the lot id", () => {
    expect(new ConcurrentStockModificationException("lot-1").message).toContain("lot-1");
  });
});
