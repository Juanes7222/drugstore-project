/**
 * Unit tests for the Firebase auth service.
 *
 * Covers the public-config fetch/cache, the popup-unavailable mapping, the
 * cancellation predicate, and closePopup's best-effort Tauri invocation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createFirebaseAuthService,
  isFirebaseConfigured,
  isGoogleSignInCancelled,
  type FirebasePublicConfig,
  type FirebaseAuthService,
} from "./firebase-auth.service";
import {
  FirebaseNotConfiguredException,
  GooglePopupUnavailableException,
} from "./exceptions";
import type { HttpClient } from "../../infrastructure/http-client";

// ---------------------------------------------------------------------------
// Firebase SDK mock
// ---------------------------------------------------------------------------

const { mockSignInWithPopup, mockGetAuth, mockInitializeApp } = vi.hoisted(
  () => {
    const mockSignInWithPopup = vi.fn();
    const mockGetAuth = vi.fn(() => ({ __brand: "auth" }));
    const mockInitializeApp = vi.fn((cfg: unknown) => ({
      __brand: "app",
      options: cfg,
    }));
    return { mockSignInWithPopup, mockGetAuth, mockInitializeApp };
  },
);

vi.mock("firebase/app", () => ({
  initializeApp: mockInitializeApp,
}));

vi.mock("firebase/auth", () => ({
  getAuth: mockGetAuth,
  // Only needs to be constructible; the providerId is never asserted because
  // the SDK call is mocked at the signInWithPopup boundary.
  GoogleAuthProvider: class {},
  signInWithPopup: mockSignInWithPopup,
}));

// ---------------------------------------------------------------------------
// Tauri invoke mock — closePopup imports it dynamically, so the module has to
// be mockable. `tauriImportThrows` drives the "not running under Tauri" branch.
// ---------------------------------------------------------------------------

const { mockInvoke, tauriImportState } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  tauriImportState: { shouldThrow: false },
}));

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: async (cmd: string, args?: unknown) => {
      if (tauriImportState.shouldThrow) {
        throw new Error("window.__TAURI_INTERNALS__ is undefined");
      }
      // Mirrors the real signature without forwarding an explicit undefined
      // for omitted args, which would change the recorded call shape.
      return args === undefined ? mockInvoke(cmd) : mockInvoke(cmd, args);
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeHttpClient = (
  get: HttpClient["get"] = vi.fn().mockResolvedValue(null),
): HttpClient => ({ get });

const makeConfiguredHttpClient = (
  overrides: Partial<FirebasePublicConfig> = {},
): HttpClient => {
  const config: FirebasePublicConfig = {
    apiKey: "api-key",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    storageBucket: "project.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc",
    measurementId: "G-ABC123",
    ...overrides,
  };
  return makeHttpClient(vi.fn().mockResolvedValue(config));
};

const makeService = (httpClient: HttpClient): FirebaseAuthService =>
  createFirebaseAuthService({ baseUrl: "http://test", httpClient });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("isFirebaseConfigured", () => {
  it("returns true when every required field is present", () => {
    const config: FirebasePublicConfig = {
      apiKey: "k",
      authDomain: "d",
      projectId: "p",
      storageBucket: null,
      messagingSenderId: null,
      appId: "a",
      measurementId: null,
    };

    expect(isFirebaseConfigured(config)).toBe(true);
  });

  it("returns false for a null config", () => {
    expect(isFirebaseConfigured(null)).toBe(false);
  });

  it("returns false when apiKey is missing", () => {
    const config: FirebasePublicConfig = {
      apiKey: null,
      authDomain: "d",
      projectId: "p",
      storageBucket: null,
      messagingSenderId: null,
      appId: "a",
      measurementId: null,
    };

    expect(isFirebaseConfigured(config)).toBe(false);
  });

  it("returns false when appId is missing", () => {
    const config: FirebasePublicConfig = {
      apiKey: "k",
      authDomain: "d",
      projectId: "p",
      storageBucket: null,
      messagingSenderId: null,
      appId: null,
      measurementId: null,
    };

    expect(isFirebaseConfigured(config)).toBe(false);
  });
});

describe("isGoogleSignInCancelled", () => {
  // The SDK namespaces every AuthError as auth/<code> (see the AuthErrorCode
  // map in @firebase/auth), so these use the real emitted form.

  it("returns true for 'auth/popup-closed-by-user'", () => {
    expect(
      isGoogleSignInCancelled({ code: "auth/popup-closed-by-user" }),
    ).toBe(true);
  });

  it("returns true for 'auth/user-cancelled'", () => {
    expect(isGoogleSignInCancelled({ code: "auth/user-cancelled" })).toBe(true);
  });

  it("returns false for the distinct 'auth/popup-blocked' code", () => {
    expect(isGoogleSignInCancelled({ code: "auth/popup-blocked" })).toBe(false);
  });

  it("returns false for an unrecognised namespaced code", () => {
    expect(isGoogleSignInCancelled({ code: "auth/internal-error" })).toBe(
      false,
    );
  });

  it("returns false for 'auth/operation-not-supported-in-this-environment'", () => {
    expect(
      isGoogleSignInCancelled({
        code: "auth/operation-not-supported-in-this-environment",
      }),
    ).toBe(false);
  });

  describe("auth/ prefix normalisation", () => {
    // The bare form is not what the SDK emits, but it is the documented
    // fallback branch in readFirebaseErrorCode and stays covered deliberately.

    it("matches a bare cancellation code with no prefix", () => {
      expect(isGoogleSignInCancelled({ code: "popup-closed-by-user" })).toBe(
        true,
      );
    });

    it("leaves a non-auth/ namespaced code untouched and matches nothing", () => {
      expect(
        isGoogleSignInCancelled({ code: "identitytoolkit/popup-closed-by-user" }),
      ).toBe(false);
    });

    it("does not treat a bare 'auth/' prefix as a cancellation", () => {
      expect(isGoogleSignInCancelled({ code: "auth/" })).toBe(false);
    });
  });

  describe("malformed input", () => {
    it("returns false for null", () => {
      expect(isGoogleSignInCancelled(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isGoogleSignInCancelled(undefined)).toBe(false);
    });

    it("returns false for a string input", () => {
      expect(isGoogleSignInCancelled("auth/popup-closed-by-user")).toBe(false);
    });

    it("returns false for an empty object with no code", () => {
      expect(isGoogleSignInCancelled({})).toBe(false);
    });

    it("returns false when code is a number", () => {
      expect(isGoogleSignInCancelled({ code: 42 })).toBe(false);
    });

    it("returns false when code is null", () => {
      expect(isGoogleSignInCancelled({ code: null })).toBe(false);
    });
  });
});

describe("createFirebaseAuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriImportState.shouldThrow = false;
  });

  describe("fetchPublicConfig", () => {
    it("requests the config endpoint with the provided base URL", async () => {
      const get = vi.fn().mockResolvedValue({ apiKey: "k" });
      const service = makeService(makeHttpClient(get));

      await service.fetchPublicConfig();

      expect(get).toHaveBeenCalledWith("/auth/firebase/config");
    });

    it("returns null when the server reports no usable config", async () => {
      const service = makeService(makeHttpClient());

      const result = await service.fetchPublicConfig();

      expect(result).toBeNull();
    });

    it("reports availability as false before the config is fetched", () => {
      const service = makeService(makeHttpClient());

      expect(service.isAvailable()).toBe(false);
    });

    it("reports availability as true after a complete config is fetched", async () => {
      const service = makeService(makeConfiguredHttpClient());

      await service.fetchPublicConfig();

      expect(service.isAvailable()).toBe(true);
    });

    it("reports availability as false when an optional field is nulled out", async () => {
      const service = makeService(
        makeConfiguredHttpClient({ projectId: null }),
      );

      await service.fetchPublicConfig();

      expect(service.isAvailable()).toBe(false);
    });

    it("returns null when the request fails at the transport layer", async () => {
      const service = makeService(
        makeHttpClient(vi.fn().mockRejectedValue(new Error("offline"))),
      );

      const result = await service.fetchPublicConfig();

      expect(result).toBeNull();
    });

    it("caches the config so the endpoint is hit only once", async () => {
      const get = vi.fn().mockResolvedValue({ apiKey: "k" });
      const service = makeService(makeHttpClient(get));

      await service.fetchPublicConfig();
      await service.fetchPublicConfig();

      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  describe("signInWithGoogle", () => {
    it("resolves with the Firebase ID token", async () => {
      mockSignInWithPopup.mockResolvedValueOnce({
        user: { getIdToken: () => "id-token-abc" },
      });
      const service = makeService(makeConfiguredHttpClient());

      const token = await service.signInWithGoogle();

      expect(token).toBe("id-token-abc");
    });

    it("maps 'auth/popup-blocked' to GooglePopupUnavailableException", async () => {
      mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBeInstanceOf(
        GooglePopupUnavailableException,
      );
    });

    it("carries the GOOGLE_POPUP_UNAVAILABLE code for 'auth/popup-blocked'", async () => {
      mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toMatchObject({
        errorCode: "GOOGLE_POPUP_UNAVAILABLE",
      });
    });

    it("maps 'auth/operation-not-supported-in-this-environment' to GooglePopupUnavailableException", async () => {
      mockSignInWithPopup.mockRejectedValueOnce({
        code: "auth/operation-not-supported-in-this-environment",
      });
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBeInstanceOf(
        GooglePopupUnavailableException,
      );
    });

    it("maps a bare 'popup-blocked' too, covering the no-prefix fallback", async () => {
      mockSignInWithPopup.mockRejectedValueOnce({ code: "popup-blocked" });
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBeInstanceOf(
        GooglePopupUnavailableException,
      );
    });

    it("rethrows an unrelated error untouched", async () => {
      const original = new Error("network down");
      mockSignInWithPopup.mockRejectedValueOnce(original);
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBe(original);
    });

    it("rethrows a cancelled popup untouched so callers can stay silent", async () => {
      const original = { code: "auth/popup-closed-by-user" };
      mockSignInWithPopup.mockRejectedValueOnce(original);
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBe(original);
    });

    it("rethrows 'auth/user-cancelled' untouched rather than mapping it", async () => {
      const original = { code: "auth/user-cancelled" };
      mockSignInWithPopup.mockRejectedValueOnce(original);
      const service = makeService(makeConfiguredHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBe(original);
    });

    it("throws FirebaseNotConfiguredException when no config was fetched", async () => {
      const service = makeService(makeHttpClient());

      await expect(service.signInWithGoogle()).rejects.toBeInstanceOf(
        FirebaseNotConfiguredException,
      );
    });

    it("throws FirebaseNotConfiguredException when the config is incomplete", async () => {
      const service = makeService(makeConfiguredHttpClient({ apiKey: null }));

      await expect(service.signInWithGoogle()).rejects.toBeInstanceOf(
        FirebaseNotConfiguredException,
      );
    });

    it("does not open a popup when Firebase is not configured", async () => {
      const service = makeService(makeHttpClient());

      await expect(service.signInWithGoogle()).rejects.toThrow();
      expect(mockSignInWithPopup).not.toHaveBeenCalled();
    });
  });

  describe("closePopup", () => {
    it("invokes the close_oauth_popup Tauri command", async () => {
      const service = makeService(makeHttpClient());

      await service.closePopup();

      expect(mockInvoke).toHaveBeenCalledWith("close_oauth_popup");
    });

    it("resolves quietly when the Tauri API is unavailable", async () => {
      tauriImportState.shouldThrow = true;
      const service = makeService(makeHttpClient());

      await expect(service.closePopup()).resolves.toBeUndefined();
    });

    it("does not invoke anything when the Tauri API is unavailable", async () => {
      tauriImportState.shouldThrow = true;
      const service = makeService(makeHttpClient());

      await service.closePopup();

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("resolves quietly when the invoke call itself rejects", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("no such command"));
      const service = makeService(makeHttpClient());

      await expect(service.closePopup()).resolves.toBeUndefined();
    });
  });
});
