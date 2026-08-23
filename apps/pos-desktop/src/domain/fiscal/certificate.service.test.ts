/**
 * Unit tests for FiscalCertificateService — client-side input validation,
 * upload (with metadata-only store mirroring) and best-effort status refresh.
 *
 * The HTTP boundary is a mock client; the certificate store is real so the
 * mirroring side effects are asserted on actual state. Offline is simulated
 * by stubbing navigator.onLine, matching company-profile.service.test.ts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  FiscalCertificateService,
  FiscalCertificateHttpError,
  MAX_CERTIFICATE_FILE_BYTES,
  type FiscalCertificateHttpClient,
  type FiscalCertificateSummary,
} from "./certificate.service";
import {
  CertificateInvalidFileException,
  CertificateUploadOfflineException,
  CertificateUploadRejectedException,
} from "./exceptions";
import { useCertificateStore } from "./certificate.store";

const BASE_URL = "http://api.test";
const TOKEN = "tok-1";

const makeSummary = (
  overrides: Partial<FiscalCertificateSummary> = {},
): FiscalCertificateSummary => ({
  id: "cert-1",
  alias: "Principal",
  subjectCn: "FARMACIA LOS ANDES S.A.S",
  issuerCn: "DIAN CA",
  validFrom: "2025-01-01T00:00:00.000Z",
  validTo: "2027-01-01T00:00:00.000Z",
  status: "ACTIVE",
  activatedAt: "2026-01-01T00:00:00.000Z",
  rotatedAt: null,
  ...overrides,
});

const makeInput = (overrides: Partial<Parameters<FiscalCertificateService["upload"]>[0]> = {}) => ({
  file: new File(["abc"], "cert.pfx"),
  password: "clave-segura",
  softwareSecurityCode: "ABCDEFGHIJ",
  ...overrides,
});

describe("FiscalCertificateService", () => {
  let http: FiscalCertificateHttpClient;
  let service: FiscalCertificateService;

  beforeEach(() => {
    localStorage.clear();
    useCertificateStore.getState().reset();
    http = { get: vi.fn(), post: vi.fn() };
    service = new FiscalCertificateService({
      baseUrl: `${BASE_URL}/`,
      httpClient: http,
      accessToken: TOKEN,
    });
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("validateInput", () => {
    it("accepts a .pfx file with a password and a long-enough security code", () => {
      expect(service.validateInput(makeInput())).toEqual({ ok: true });
    });

    it("accepts a .p12 file", () => {
      const input = makeInput({ file: new File(["abc"], "cert.p12") });

      expect(service.validateInput(input)).toEqual({ ok: true });
    });

    it("accepts an uppercase extension", () => {
      const input = makeInput({ file: new File(["abc"], "cert.PFX") });

      expect(service.validateInput(input)).toEqual({ ok: true });
    });

    it("rejects a file with a non-certificate extension", () => {
      const input = makeInput({ file: new File(["abc"], "cert.txt") });

      expect(service.validateInput(input)).toEqual({
        ok: false,
        code: "INVALID_FILE_TYPE",
      });
    });

    it("rejects a file without an extension", () => {
      const input = makeInput({ file: new File(["abc"], "cert") });

      expect(service.validateInput(input)).toEqual({
        ok: false,
        code: "INVALID_FILE_TYPE",
      });
    });

    it("rejects a file larger than the 3 MB limit", () => {
      const oversized = new File(
        ["x".repeat(MAX_CERTIFICATE_FILE_BYTES + 1)],
        "cert.pfx",
      );

      expect(service.validateInput(makeInput({ file: oversized }))).toEqual({
        ok: false,
        code: "FILE_TOO_LARGE",
      });
    });

    it("accepts a file exactly at the 3 MB limit", () => {
      const atLimit = new File(
        ["x".repeat(MAX_CERTIFICATE_FILE_BYTES)],
        "cert.pfx",
      );

      expect(service.validateInput(makeInput({ file: atLimit }))).toEqual({
        ok: true,
      });
    });

    it("rejects an empty password", () => {
      expect(
        service.validateInput(makeInput({ password: "" })),
      ).toEqual({
        ok: false,
        code: "PASSWORD_REQUIRED",
      });
    });

    it("rejects a security code shorter than 10 characters", () => {
      expect(
        service.validateInput(makeInput({ softwareSecurityCode: "ABCDEFGHI" })),
      ).toEqual({
        ok: false,
        code: "SECURITY_CODE_TOO_SHORT",
      });
    });

    it("accepts a 10-character security code", () => {
      expect(
        service.validateInput(makeInput({ softwareSecurityCode: "ABCDEFGHIJ" })),
      ).toEqual({ ok: true });
    });
  });

  describe("upload", () => {
    it("POSTs the base64 file and credentials, then mirrors metadata only into the store", async () => {
      const summary = makeSummary();
      vi.mocked(http.post).mockResolvedValue(summary);

      await service.upload(makeInput());

      expect(http.post).toHaveBeenCalledWith(
        `${BASE_URL}/fiscal-dian/certificates`,
        {
          alias: "Principal",
          certificateBase64: "YWJj",
          password: "clave-segura",
          softwareSecurityCode: "ABCDEFGHIJ",
        },
        { Authorization: `Bearer ${TOKEN}` },
      );

      const store = useCertificateStore.getState();
      expect(store.status).toBe("ACTIVE");
      expect(store.alias).toBe("Principal");
      expect(store.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
      expect(store.validTo).toBe("2027-01-01T00:00:00.000Z");
      expect(store.lastCheckedAt).not.toBeNull();
      expect(store).not.toHaveProperty("password");
      expect(store).not.toHaveProperty("certificateBase64");
      expect(store).not.toHaveProperty("file");
    });

    it("defaults the alias to Principal when none is supplied", async () => {
      vi.mocked(http.post).mockResolvedValue(makeSummary());

      await service.upload(makeInput({ alias: "   " }));

      const body = vi.mocked(http.post).mock.calls[0][1] as Record<string, string>;
      expect(body.alias).toBe("Principal");
    });

    it("trims the alias and the security code before posting", async () => {
      vi.mocked(http.post).mockResolvedValue(makeSummary());

      await service.upload(
        makeInput({ alias: "  Backup  ", softwareSecurityCode: "  ABCDEFGHIJ  " }),
      );

      const body = vi.mocked(http.post).mock.calls[0][1] as Record<string, string>;
      expect(body.alias).toBe("Backup");
      expect(body.softwareSecurityCode).toBe("ABCDEFGHIJ");
    });

    it("throws CertificateInvalidFileException without calling the server on failed validation", async () => {
      const input = makeInput({ file: new File(["abc"], "cert.txt") });

      await expect(service.upload(input)).rejects.toThrow(
        new CertificateInvalidFileException("INVALID_FILE_TYPE"),
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it("throws CertificateUploadOfflineException without calling the server when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await expect(service.upload(makeInput())).rejects.toThrow(
        CertificateUploadOfflineException,
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it("throws CertificateUploadOfflineException without calling the server when no access token is present", async () => {
      const anonymous = new FiscalCertificateService({
        baseUrl: BASE_URL,
        httpClient: http,
      });

      await expect(anonymous.upload(makeInput())).rejects.toThrow(
        CertificateUploadOfflineException,
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it("throws CertificateUploadRejectedException with the status code on a 4xx response", async () => {
      vi.mocked(http.post).mockRejectedValue(
        new FiscalCertificateHttpError(
          `${BASE_URL}/fiscal-dian/certificates`,
          422,
          "NIT mismatch",
        ),
      );

      await expect(service.upload(makeInput())).rejects.toThrow(
        new CertificateUploadRejectedException(422, "NIT mismatch"),
      );
      expect(useCertificateStore.getState().status).toBe("NONE");
    });

    it("rethrows unexpected network errors as-is", async () => {
      const networkError = new TypeError("fetch failed");
      vi.mocked(http.post).mockRejectedValue(networkError);

      await expect(service.upload(makeInput())).rejects.toThrow(networkError);
    });
  });

  describe("refreshStatus", () => {
    it("returns null without calling the server when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await expect(service.refreshStatus()).resolves.toBeNull();
      expect(http.get).not.toHaveBeenCalled();
    });

    it("returns null without calling the server without an access token", async () => {
      const anonymous = new FiscalCertificateService({
        baseUrl: BASE_URL,
        httpClient: http,
      });

      await expect(anonymous.refreshStatus()).resolves.toBeNull();
      expect(http.get).not.toHaveBeenCalled();
    });

    it("mirrors the ACTIVE certificate when the server list has one", async () => {
      const active = makeSummary();
      vi.mocked(http.get).mockResolvedValue([
        makeSummary({ id: "cert-0", status: "EXPIRED", alias: "Vieja" }),
        active,
      ]);

      const result = await service.refreshStatus();

      expect(http.get).toHaveBeenCalledWith(
        `${BASE_URL}/fiscal-dian/certificates`,
        { Authorization: `Bearer ${TOKEN}` },
      );
      expect(result).toEqual(active);
      const store = useCertificateStore.getState();
      expect(store.status).toBe("ACTIVE");
      expect(store.alias).toBe("Principal");
      expect(store.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
    });

    it("mirrors the first certificate when the server list has no ACTIVE entry", async () => {
      const expired = makeSummary({
        status: "EXPIRED",
        alias: "Vencida",
        validTo: "2020-01-01T00:00:00.000Z",
      });
      vi.mocked(http.get).mockResolvedValue([expired]);

      await service.refreshStatus();

      const store = useCertificateStore.getState();
      expect(store.alias).toBe("Vencida");
      expect(store.status).toBe("EXPIRED");
    });

    it("clears the certificate store when the server list is empty", async () => {
      useCertificateStore.getState().setCertificate({
        alias: "Principal",
        subjectCn: "OLD CN",
        validFrom: null,
        validTo: "2027-01-01T00:00:00.000Z",
      });
      vi.mocked(http.get).mockResolvedValue([]);

      const result = await service.refreshStatus();

      expect(result).toBeNull();
      const store = useCertificateStore.getState();
      expect(store.status).toBe("NONE");
      expect(store.alias).toBeNull();
      expect(store.subjectCn).toBeNull();
    });

    it("returns null and leaves the store untouched when the server request fails", async () => {
      useCertificateStore.getState().setCertificate({
        alias: "Principal",
        subjectCn: "KEEP CN",
        validFrom: null,
        validTo: "2027-01-01T00:00:00.000Z",
      });
      vi.mocked(http.get).mockRejectedValue(new Error("boom"));

      const result = await service.refreshStatus();

      expect(result).toBeNull();
      const store = useCertificateStore.getState();
      expect(store.status).toBe("ACTIVE");
      expect(store.subjectCn).toBe("KEEP CN");
    });
  });
});