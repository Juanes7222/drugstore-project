import { describe, expect, it } from "vitest";
import {
  PrescriptionSaleItemNotFoundException,
  PrescriptionNotFoundException,
  ControlledSubstanceFieldsRequiredException,
  PrescriptionAlreadyExistsException,
} from "./exceptions";

describe("PrescriptionSaleItemNotFoundException", () => {
  it("includes the sale item id", () => {
    expect(new PrescriptionSaleItemNotFoundException("si-1").message).toContain("si-1");
  });
});

describe("PrescriptionNotFoundException", () => {
  it("includes the prescription id", () => {
    expect(new PrescriptionNotFoundException("rx-1").message).toContain("rx-1");
  });
});

describe("ControlledSubstanceFieldsRequiredException", () => {
  it("includes the missing field name", () => {
    const e = new ControlledSubstanceFieldsRequiredException("bookEntry");
    expect(e.message).toContain("bookEntry");
  });
});

describe("PrescriptionAlreadyExistsException", () => {
  it("includes the sale item id", () => {
    expect(new PrescriptionAlreadyExistsException("si-1").message).toContain("si-1");
  });
});
