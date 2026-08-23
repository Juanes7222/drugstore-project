/**
 * Component tests for CertificateStatusBanner — the persistent DIAN
 * certificate reminder: invisible for PROVIDER/legacy plans and for a
 * healthy certificate, visible with a CTA for NONE / EXPIRING / EXPIRED.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CertificateStatusBanner } from "./certificate-status-banner";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import type { CertificateStatus } from "../../../domain/fiscal";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseFiscalCertificate = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-fiscal-certificate", () => ({
  useFiscalCertificate: mockUseFiscalCertificate,
}));

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => undefined,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setBillingMethod = (billingMethod: string | null): void => {
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

const setupHook = (overrides: {
  status?: CertificateStatus;
  validTo?: string | null;
  needsCertificate?: boolean;
} = {}): void => {
  mockUseFiscalCertificate.mockReturnValue({
    status: "NONE",
    alias: null,
    subjectCn: null,
    validTo: null,
    lastCheckedAt: null,
    uploadErrorCode: null,
    isUploading: false,
    needsCertificate: false,
    upload: vi.fn(),
    refresh: vi.fn(),
    clearUploadError: vi.fn(),
    ...overrides,
  });
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CertificateStatusBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockUseFiscalCertificate.mockReset();
    mockDispatch.mockReset();
    setupHook();
  });

  it("renders nothing for a PROVIDER plan", () => {
    setBillingMethod("PROVIDER");
    render(<CertificateStatusBanner />);

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders nothing for a legacy plan without a billing method", () => {
    setBillingMethod(null);
    render(<CertificateStatusBanner />);

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders nothing for a healthy ACTIVE certificate on a CERTIFICATE plan", () => {
    setBillingMethod("CERTIFICATE");
    setupHook({ status: "ACTIVE", needsCertificate: false });
    render(<CertificateStatusBanner />);

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows the setup CTA when the certificate is missing and dispatches the setup screen", async () => {
    const user = userEvent.setup();
    setBillingMethod("CERTIFICATE");
    setupHook({ status: "NONE", needsCertificate: true });
    render(<CertificateStatusBanner />);

    const region = screen.getByRole("region", {
      name: "Estado del certificado DIAN",
    });
    expect(region).toHaveTextContent(/Sube tu certificado DIAN/);

    await user.click(
      screen.getByRole("button", { name: "Subir certificado" }),
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      setActiveScreen("certificate-setup"),
    );
  });

  it("shows the expiring warning with the expiry date", () => {
    setBillingMethod("CERTIFICATE");
    setupHook({ status: "EXPIRING", validTo: "2026-09-01T00:00:00.000Z" });
    render(<CertificateStatusBanner />);

    expect(
      screen.getByRole("region", { name: "Estado del certificado DIAN" }),
    ).toHaveTextContent(/vence el/);
    expect(
      screen.getByRole("button", { name: "Actualizar certificado" }),
    ).toBeInTheDocument();
  });

  it("shows the expired suspension notice", () => {
    setBillingMethod("CERTIFICATE");
    setupHook({ status: "EXPIRED" });
    render(<CertificateStatusBanner />);

    expect(
      screen.getByRole("region", { name: "Estado del certificado DIAN" }),
    ).toHaveTextContent(/venció/);
    expect(
      screen.getByRole("button", { name: "Actualizar certificado" }),
    ).toBeInTheDocument();
  });

  it("dispatches the setup screen from the expiring CTA", async () => {
    const user = userEvent.setup();
    setBillingMethod("CERTIFICATE");
    setupHook({ status: "EXPIRING", validTo: "2026-09-01T00:00:00.000Z" });
    render(<CertificateStatusBanner />);

    await user.click(
      screen.getByRole("button", { name: "Actualizar certificado" }),
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      setActiveScreen("certificate-setup"),
    );
  });
});