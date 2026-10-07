import { describe, it, expect } from "@jest/globals";
import {
  ResendVerificationSchema,
  VerifyEmailSchema,
} from "./email-verification.dto";

// A 32-byte base64url secret, the shape issue() actually produces.
const VALID_TOKEN = "a".repeat(43);

describe("VerifyEmailSchema", () => {
  it("accepts a token of the length issue() produces", () => {
    expect(VerifyEmailSchema.parse({ token: VALID_TOKEN }).token).toBe(
      VALID_TOKEN,
    );
  });

  // The minimum is deliberately 1, not the 43 characters issue() produces: a
  // truncated link must reach the service and come back as
  // AUTH_INVALID_VERIFICATION_TOKEN, the single code the client branches on,
  // rather than as a generic schema BAD_REQUEST that depends on how the link
  // was damaged.
  it("accepts a single-character token so unusable links reach the service", () => {
    expect(VerifyEmailSchema.parse({ token: "a" }).token).toBe("a");
  });

  it("rejects an empty token", () => {
    expect(() => VerifyEmailSchema.parse({ token: "" })).toThrow();
  });

  it("rejects a token longer than the maximum length", () => {
    expect(() => VerifyEmailSchema.parse({ token: "a".repeat(201) })).toThrow();
  });

  it("rejects a missing token", () => {
    expect(() => VerifyEmailSchema.parse({})).toThrow();
  });

  it("rejects a non-string token", () => {
    expect(() => VerifyEmailSchema.parse({ token: 12345 })).toThrow();
  });

  it("drops unknown properties instead of rejecting them", () => {
    expect(
      VerifyEmailSchema.parse({ token: VALID_TOKEN, extra: "ignored" }),
    ).toEqual({ token: VALID_TOKEN });
  });
});

describe("ResendVerificationSchema", () => {
  it("accepts a valid address", () => {
    expect(
      ResendVerificationSchema.parse({ email: "user@example.com" }).email,
    ).toBe("user@example.com");
  });

  it("rejects a malformed address", () => {
    expect(() =>
      ResendVerificationSchema.parse({ email: "not-an-email" }),
    ).toThrow();
  });

  it("rejects a missing address", () => {
    expect(() => ResendVerificationSchema.parse({})).toThrow();
  });

  it("rejects an empty address", () => {
    expect(() => ResendVerificationSchema.parse({ email: "" })).toThrow();
  });
});
