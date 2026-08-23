/**
 * Unit tests for useFiscalCertificate — needsCertificate gating, upload
 * lifecycle (client-side validation codes vs domain exceptions) and the
 * best-effort status refresh on mount.
 *
 * Stores are real (asserted on actual state); the network boundary is a
 * mocked global fetch, matching use-company-setup.test.tsx.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFiscalCertificate } from "./use-fiscal-certificate";
import { useCertificateStore } from "../../domain/fiscal";
import {
  CertificateUploadOfflineException,
  CertificateUploadRejectedException,
} from "../../domain/fiscal";
import { useLicenseStore } from "../../domain/licensing/license.store";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../../domain/auth/local-session.store";

const BASE_URL = "http://api.test";

const makeSession = (accessToken: string): LocalSession => ({
  userId: "u-1",
  username: "owner",
  fullName: "Owner",
  displayName: "Owner",
  role: "OWNER",
  subscriptionId: "s-1",
  workstationId: "ws-1",
  accessToken,
  refreshToken: "",
  sessionId: "sess-1",
  sessionTrust: "SERVER_VERIFIED",
});

const activateWithPlan = (billingMethod: string | null): void => {
  useLicenseStore.getState().setActivated({
    activationToken: "token-abc",
    expiresAt: "2027-01-01T00:00:00.000Z",
    subscription: {
      id: "sub-1",
      status: "ACTIVE",
      currentPeriodEnd: "2027-01-01T00:00:00.000Z",
      gracePeriodDays: 7,
    },
    location: null,
    plan: {
      id: "plan-1",
      code: "CUSTOM",
      name: "Autogestionado",
      billingMethod,
      features: [],
      maxLocations: 1,
      maxWorkstationsPerLocation: 1,
    },
    workstationActivation: {
      id: "ws-1",
      workstationName: "Caja-01",
      activatedAt: "2026-01-15T10:00:00.000Z",
    },
    hardwareFingerprint: "fp-001",
  });
};

const makeInput = () => ({
  file: new File(["abc"], "cert.pfx"),
  password: "clave-segura",
  softwareSecurityCode: "ABCDEFGHIJ",
});

const summary = {
  id: "cert-1",
  alias: "Principal",
  subjectCn: "FARMACIA LOS ANDES S.A.S",
  issuerCn: "DIAN CA",
  validFrom: null,
  validTo: "2027-01-01T00:00:00.000Z",
  status: "ACTIVE",
  activatedAt: null,
  rotatedAt: null,
};

// The mount effect (GET refresh) and the upload (POST) share one fetch mock.
// A fresh Response per call keeps each consumer's body readable, and the
// refresh always receives an array (the server list shape).
const mockFetchUpload = (postJson: unknown, postStatus = 200): ReturnType<typeof vi.spyOn> =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if ((init as RequestInit)?.method === "POST") {
      return new Response(JSON.stringify(postJson), { status: postStatus });
    }
    return new Response(JSON.stringify([summary]), { status: 200 });
  });

describe("useFiscalCertificate", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    useCertificateStore.getState().reset();
    useLocalSessionStore.getState().clearSession();
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("needsCertificate", () => {
    it("is false when the plan billing method is not CERTIFICATE", () => {
      activateWithPlan("PROVIDER");

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      expect(result.current.needsCertificate).toBe(false);
    });

    it("is false when the store has no billing method (legacy plan)", () => {
      activateWithPlan(null);

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      expect(result.current.needsCertificate).toBe(false);
    });

    it("is true only for a CERTIFICATE plan with no certificate configured", () => {
      activateWithPlan("CERTIFICATE");

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      expect(result.current.needsCertificate).toBe(true);
    });

    it("is false for a CERTIFICATE plan once a certificate is configured", () => {
      activateWithPlan("CERTIFICATE");
      useCertificateStore.getState().setCertificate({
        alias: "Principal",
        subjectCn: "FARMACIA LOS ANDES S.A.S",
        validFrom: null,
        validTo: "2027-01-01T00:00:00.000Z",
      });

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      expect(result.current.needsCertificate).toBe(false);
      expect(result.current.status).toBe("ACTIVE");
    });
  });

  describe("upload", () => {
    it("returns false with a validation code and no network call for an invalid file type", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));
      const input = { ...makeInput(), file: new File(["abc"], "cert.txt") };

      const outcome = await act(async () => result.current.upload(input));

      expect(outcome).toBe(false);
      expect(result.current.uploadErrorCode).toBe("INVALID_FILE_TYPE");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports a short security code without a network call", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      const outcome = await act(async () =>
        result.current.upload({ ...makeInput(), softwareSecurityCode: "ABCDEFGHI" }),
      );

      expect(outcome).toBe(false);
      expect(result.current.uploadErrorCode).toBe("SECURITY_CODE_TOO_SHORT");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("uploads a valid input and mirrors metadata into the store", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      const fetchSpy = mockFetchUpload(summary);
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      const outcome = await act(async () => result.current.upload(makeInput()));

      expect(outcome).toBe(true);
      const postCall = fetchSpy.mock.calls.find(
        ([, init]: [RequestInfo | URL, RequestInit?]) =>
          (init as RequestInit).method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(postCall![0]).toBe(`${BASE_URL}/fiscal-dian/certificates`);
      expect(postCall![1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer tok-1",
          }),
        }),
      );
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.certificateBase64).toBe("YWJj");
      expect(body.password).toBe("clave-segura");
      expect(body.softwareSecurityCode).toBe("ABCDEFGHIJ");

      const store = useCertificateStore.getState();
      expect(store.status).toBe("ACTIVE");
      expect(store.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
      expect(store).not.toHaveProperty("password");
      expect(store).not.toHaveProperty("certificateBase64");
    });

    it("throws CertificateUploadRejectedException when the server rejects", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      mockFetchUpload("NIT mismatch", 422);
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      await act(async () => {
        await expect(result.current.upload(makeInput())).rejects.toThrow(
          CertificateUploadRejectedException,
        );
      });
    });

    it("throws CertificateUploadOfflineException without a network call when offline", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      vi.stubGlobal("navigator", { onLine: false });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      await act(async () => {
        await expect(result.current.upload(makeInput())).rejects.toThrow(
          CertificateUploadOfflineException,
        );
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws CertificateUploadOfflineException without a network call when no session token exists", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      await act(async () => {
        await expect(result.current.upload(makeInput())).rejects.toThrow(
          CertificateUploadOfflineException,
        );
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("status refresh on mount", () => {
    it("mirrors the ACTIVE certificate from the server when a token exists", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([summary]), { status: 200 }),
      );

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      await waitFor(() => {
        expect(result.current.status).toBe("ACTIVE");
      });
      expect(result.current.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
    });

    it("skips the refresh entirely without a token and keeps NONE", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      expect(result.current.status).toBe("NONE");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("stays NONE when the refresh fails (best-effort)", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
      expect(result.current.status).toBe("NONE");
      expect(result.current.lastCheckedAt).toBeNull();
    });
  });

  describe("clearUploadError", () => {
    it("clears the transient upload error code from the store", async () => {
      const { result } = renderHook(() => useFiscalCertificate({ baseUrl: BASE_URL }));

      act(() => useCertificateStore.getState().setUploadError("INVALID_FILE_TYPE"));
      expect(result.current.uploadErrorCode).toBe("INVALID_FILE_TYPE");

      act(() => result.current.clearUploadError());

      expect(result.current.uploadErrorCode).toBeNull();
    });
  });
});