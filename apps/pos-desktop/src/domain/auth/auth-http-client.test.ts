/**
 * Tests for the auth HTTP client.
 *
 * Each method is tested with a successful response, a non-ok HTTP status, and
 * a network-level failure (TypeError thrown by fetch).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAuthHttpClient } from "./auth-http-client";
import { InvalidCredentialsException } from "./exceptions";

const BASE_URL = "https://api.example.com/auth";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createAuthHttpClient", () => {
  // -------------------------------------------------------------------
  // post
  // -------------------------------------------------------------------

  describe("post", () => {
    it("sends a POST request and returns the parsed JSON body", async () => {
      const fakeResponse = { ok: true, json: () => Promise.resolve({ token: "abc" }) };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      const result = await client.post<{ token: string }>("/login", { username: "test" });

      expect(result).toEqual({ token: "abc" });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("throws InvalidCredentialsException when the server responds 4xx", async () => {
      const fakeResponse = {
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "bad credentials" }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.post("/login", {})).rejects.toThrow(InvalidCredentialsException);
    });

    it("throws InvalidCredentialsException when the response body has no message", async () => {
      const fakeResponse = {
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.post("/login", {})).rejects.toThrow(InvalidCredentialsException);
    });

    it("throws InvalidCredentialsException when json parsing fails on error", async () => {
      const fakeResponse = {
        ok: false,
        status: 401,
        json: () => Promise.reject(new Error("parse failure")),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.post("/login", {})).rejects.toThrow(InvalidCredentialsException);
    });

    it("propagates a network error (fetch throws TypeError)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network failure"));

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.post("/login", {})).rejects.toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------
  // postWithAuth
  // -------------------------------------------------------------------

  describe("postWithAuth", () => {
    it("sends an authenticated POST and returns the parsed body", async () => {
      const fakeResponse = { ok: true, json: () => Promise.resolve({ id: 1 }) };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      const result = await client.postWithAuth<{ id: number }>("/refresh", {}, "token-xyz");

      expect(result).toEqual({ id: 1 });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/refresh",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer token-xyz",
          },
        }),
      );
    });

    it("throws a generic Error on non-ok response", async () => {
      const fakeResponse = {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: () => Promise.resolve({}),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.postWithAuth("/refresh", {}, "token")).rejects.toThrow("HTTP 403: Forbidden");
    });

    it("includes the server error message in the thrown Error when available", async () => {
      const fakeResponse = {
        ok: false,
        status: 422,
        statusText: "Unprocessable",
        json: () => Promise.resolve({ message: "Invalid payload" }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.postWithAuth("/refresh", {}, "token")).rejects.toThrow("Invalid payload");
    });

    it("propagates TypeError for network failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.postWithAuth("/refresh", {}, "token")).rejects.toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------
  // getWithAuth
  // -------------------------------------------------------------------

  describe("getWithAuth", () => {
    it("sends an authenticated GET and returns the parsed body", async () => {
      const fakeResponse = { ok: true, json: () => Promise.resolve({ name: "test" }) };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      const result = await client.getWithAuth<{ name: string }>("/me", "token-xyz");

      expect(result).toEqual({ name: "test" });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/me",
        expect.objectContaining({
          method: "GET",
          headers: { Authorization: "Bearer token-xyz" },
        }),
      );
    });

    it("throws a generic Error on non-ok response", async () => {
      const fakeResponse = {
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: () => Promise.resolve({}),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.getWithAuth("/me", "token")).rejects.toThrow("HTTP 500: Server Error");
    });

    it("includes the server error message when available", async () => {
      const fakeResponse = {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ message: "Token expired" }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.getWithAuth("/me", "token")).rejects.toThrow("Token expired");
    });

    it("propagates TypeError for network failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("timeout"));

      const client = createAuthHttpClient(BASE_URL);
      await expect(client.getWithAuth("/me", "token")).rejects.toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------
  // URL construction
  // -------------------------------------------------------------------

  it("strips trailing slash from base URL", async () => {
    const fakeResponse = { ok: true, json: () => Promise.resolve({}) };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse as Response);

    const client = createAuthHttpClient("https://example.com/api/");
    await client.post("/login", {});

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/login",
      expect.anything(),
    );
  });
});
