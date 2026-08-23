/**
 * Unit tests for the DIAN certificate Zustand store — status derivation from
 * the validity window, clearing/upload-error actions, and the persist
 * partialize contract (metadata only, never the file or the password).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  useCertificateStore,
  CERTIFICATE_EXPIRY_WARNING_DAYS,
  type CertificateSummary,
} from "./certificate.store";

const DAY_MS = 24 * 60 * 60 * 1000;

const makeSummary = (
  validTo: string | null,
  overrides: Partial<CertificateSummary> = {},
): CertificateSummary => ({
  alias: "Principal",
  subjectCn: "FARMACIA LOS ANDES S.A.S",
  validFrom: null,
  validTo,
  ...overrides,
});

const inDays = (days: number): string =>
  new Date(Date.now() + days * DAY_MS).toISOString();

describe("useCertificateStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useCertificateStore.getState().reset();
  });

  describe("setCertificate", () => {
    it("derives ACTIVE when the certificate expires more than 30 days out", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(31)));

      expect(useCertificateStore.getState().status).toBe("ACTIVE");
    });

    it("derives EXPIRING when the certificate expires within 30 days", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(30)));

      expect(useCertificateStore.getState().status).toBe("EXPIRING");
    });

    it("derives EXPIRED when the certificate already expired", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(-1)));

      expect(useCertificateStore.getState().status).toBe("EXPIRED");
    });

    it("derives EXPIRED when the validity end is not a parseable date", () => {
      useCertificateStore.getState().setCertificate(makeSummary("not-a-date"));

      expect(useCertificateStore.getState().status).toBe("EXPIRED");
    });

    it("derives ACTIVE when the validity end is missing", () => {
      useCertificateStore.getState().setCertificate(makeSummary(null));

      expect(useCertificateStore.getState().status).toBe("ACTIVE");
    });

    it("mirrors the summary fields and stamps lastCheckedAt", () => {
      const validTo = inDays(60);
      useCertificateStore.getState().setCertificate(
        makeSummary(validTo, { alias: "Backup" }),
      );

      const state = useCertificateStore.getState();
      expect(state.alias).toBe("Backup");
      expect(state.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
      expect(state.validTo).toBe(validTo);
      expect(state.lastCheckedAt).not.toBeNull();
    });

    it("clears any pending upload error", () => {
      useCertificateStore.getState().setUploadError("INVALID_FILE_TYPE");

      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(31)));

      expect(useCertificateStore.getState().uploadErrorCode).toBeNull();
    });
  });

  describe("clearCertificate", () => {
    it("returns the store to NONE with all metadata cleared", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(60)));

      useCertificateStore.getState().clearCertificate();

      const state = useCertificateStore.getState();
      expect(state.status).toBe("NONE");
      expect(state.alias).toBeNull();
      expect(state.subjectCn).toBeNull();
      expect(state.validTo).toBeNull();
      expect(state.lastCheckedAt).not.toBeNull();
    });
  });

  describe("setUploadError / reset", () => {
    it("stores the transient error code", () => {
      useCertificateStore.getState().setUploadError("PASSWORD_REQUIRED");

      expect(useCertificateStore.getState().uploadErrorCode).toBe(
        "PASSWORD_REQUIRED",
      );
    });

    it("clears the error code with a null argument", () => {
      useCertificateStore.getState().setUploadError("PASSWORD_REQUIRED");

      useCertificateStore.getState().setUploadError(null);

      expect(useCertificateStore.getState().uploadErrorCode).toBeNull();
    });

    it("reset restores the full initial state", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(60)));
      useCertificateStore.getState().setUploadError("OFFLINE");

      useCertificateStore.getState().reset();

      const state = useCertificateStore.getState();
      expect(state.status).toBe("NONE");
      expect(state.alias).toBeNull();
      expect(state.subjectCn).toBeNull();
      expect(state.validTo).toBeNull();
      expect(state.lastCheckedAt).toBeNull();
      expect(state.uploadErrorCode).toBeNull();
    });
  });

  describe("persist middleware", () => {
    it("persists metadata only — never the upload error, password or file bytes", () => {
      useCertificateStore
        .getState()
        .setCertificate(makeSummary(inDays(60)));
      useCertificateStore.getState().setUploadError("SERVER_REJECTED");

      const stored = localStorage.getItem("pharmacy-fiscal-certificate-store");
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.status).toBe("ACTIVE");
      expect(parsed.state.alias).toBe("Principal");
      expect(parsed.state.subjectCn).toBe("FARMACIA LOS ANDES S.A.S");
      expect(parsed.state.validTo).not.toBeNull();
      expect(parsed.state.lastCheckedAt).not.toBeNull();
      expect(parsed.state.uploadErrorCode).toBeUndefined();
      expect(parsed.state.password).toBeUndefined();
      expect(parsed.state.certificateBase64).toBeUndefined();
      expect(parsed.state.file).toBeUndefined();
    });

    it("rehydrates the persisted status on a fresh store with the same key", async () => {
      const expiringValidTo = inDays(10);
      localStorage.setItem(
        "pharmacy-fiscal-certificate-store",
        JSON.stringify({
          state: {
            status: "EXPIRING",
            alias: "Principal",
            subjectCn: "FARMACIA LOS ANDES S.A.S",
            validTo: expiringValidTo,
            lastCheckedAt: "2026-08-01T00:00:00.000Z",
          },
          version: 0,
        }),
      );

      vi.resetModules();
      const fresh = await import("./certificate.store");

      expect(fresh.useCertificateStore.getState().status).toBe("EXPIRING");
      expect(fresh.useCertificateStore.getState().alias).toBe("Principal");
      expect(fresh.useCertificateStore.getState().validTo).toBe(expiringValidTo);
      expect(fresh.useCertificateStore.getState().uploadErrorCode).toBeNull();
    });
  });
});

describe("CERTIFICATE_EXPIRY_WARNING_DAYS", () => {
  it("is the 30-day warning window the status derivation relies on", () => {
    expect(CERTIFICATE_EXPIRY_WARNING_DAYS).toBe(30);
  });
});