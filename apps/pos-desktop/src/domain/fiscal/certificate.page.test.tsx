/**
 * Component tests for CertificateSetupPage — the onboarding gate of the
 * CERTIFICATE billing plan: form view, configured view, expiring/expired
 * notices, upload error mapping and skip/finish navigation.
 *
 * The pos-local hook boundary is mocked; the real CertificateUploadStep is
 * mounted so the full form interaction is exercised.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CertificateSetupPage } from "./certificate.page";
import { navigateToHome } from "@/store/slices/ui-slice";
import {
  CertificateUploadOfflineException,
  CertificateUploadRejectedException,
} from "./exceptions";
import type { CertificateUploadInput } from "./certificate.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseFiscalCertificate = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
const mockClearUploadError = vi.hoisted(() => vi.fn());

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

interface HookState {
  status: "NONE" | "ACTIVE" | "EXPIRING" | "EXPIRED";
  subjectCn: string | null;
  validTo: string | null;
  isUploading: boolean;
  uploadErrorCode: string | null;
}

const setupHook = (overrides: Partial<HookState> = {}): void => {
  mockUseFiscalCertificate.mockReturnValue({
    status: "NONE",
    alias: null,
    subjectCn: null,
    validTo: null,
    lastCheckedAt: null,
    uploadErrorCode: null,
    isUploading: false,
    needsCertificate: false,
    upload: mockUpload,
    refresh: vi.fn(),
    clearUploadError: mockClearUploadError,
    ...overrides,
  });
};

const makeFile = (): File => new File(["abc"], "cert.pfx");

const pickCertificateAndFillForm = async (): Promise<void> => {
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Subir el archivo del certificado DIAN"),
    makeFile(),
  );
  await user.type(
    screen.getByLabelText("Contraseña del certificado"),
    "clave-segura",
  );
  await user.type(
    screen.getByLabelText("Código de seguridad del software"),
    "ABCDEFGHIJ",
  );
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CertificateSetupPage", () => {
  beforeEach(() => {
    mockUseFiscalCertificate.mockReset();
    mockDispatch.mockReset();
    mockUpload.mockReset();
    mockClearUploadError.mockReset();
    setupHook();
  });

  it("shows the upload form when no certificate is configured", () => {
    render(<CertificateSetupPage />);

    expect(
      screen.getByRole("heading", { name: "Tu certificado DIAN" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Seleccionar archivo .pfx o .p12/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Contraseña del certificado"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Código de seguridad del software"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lo haré después" }),
    ).toBeInTheDocument();
  });

  it("shows the configured view with the subject and validity when ACTIVE", () => {
    setupHook({
      status: "ACTIVE",
      subjectCn: "FARMACIA LOS ANDES S.A.S",
      validTo: "2027-01-01T00:00:00.000Z",
    });
    render(<CertificateSetupPage />);

    expect(
      screen.getByRole("heading", { name: "Certificado configurado" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Titular: FARMACIA LOS ANDES S.A.S/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuar al sistema" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Contraseña del certificado"),
    ).not.toBeInTheDocument();
  });

  it("navigates home from the configured view", async () => {
    const user = userEvent.setup();
    setupHook({ status: "ACTIVE" });
    render(<CertificateSetupPage />);

    await user.click(
      screen.getByRole("button", { name: "Continuar al sistema" }),
    );

    expect(mockDispatch).toHaveBeenCalledWith(navigateToHome());
  });

  it("shows an expiry warning and keeps the form when EXPIRING", () => {
    setupHook({ status: "EXPIRING", validTo: "2026-09-01T00:00:00.000Z" });
    render(<CertificateSetupPage />);

    // The banner renders "certificate_banner.expiring_message" with the
    // expiry date interpolated; the alert role carries the warning.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tu certificado DIAN" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Contraseña del certificado"),
    ).toBeInTheDocument();
  });

  it("shows an expired notice and keeps the form when EXPIRED", () => {
    setupHook({ status: "EXPIRED" });
    render(<CertificateSetupPage />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Código de seguridad del software"),
    ).toBeInTheDocument();
  });

  it("shows the configured view after a successful upload", async () => {
    const user = userEvent.setup();
    mockUpload.mockImplementation(async () => {
      setupHook({
        status: "ACTIVE",
        subjectCn: "FARMACIA LOS ANDES S.A.S",
        validTo: "2027-01-01T00:00:00.000Z",
      });
      return true;
    });
    const { rerender } = render(<CertificateSetupPage />);

    await pickCertificateAndFillForm();
    await user.click(
      screen.getByRole("button", { name: "Subir certificado" }),
    );

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1);
    });
    const input = mockUpload.mock.calls[0][0] as CertificateUploadInput;
    expect(input.file.name).toBe("cert.pfx");
    expect(input.password).toBe("clave-segura");
    expect(input.softwareSecurityCode).toBe("ABCDEFGHIJ");

    rerender(<CertificateSetupPage />);

    expect(
      screen.getByRole("heading", { name: "Certificado configurado" }),
    ).toBeInTheDocument();
  });

  it("shows the OFFLINE error when the upload fails offline", async () => {
    const user = userEvent.setup();
    mockUpload.mockRejectedValue(new CertificateUploadOfflineException());
    render(<CertificateSetupPage />);

    await pickCertificateAndFillForm();
    await user.click(
      screen.getByRole("button", { name: "Subir certificado" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /No hay conexión a internet/,
      );
    });
  });

  it("shows the SERVER_REJECTED error when the server rejects the upload", async () => {
    const user = userEvent.setup();
    mockUpload.mockRejectedValue(
      new CertificateUploadRejectedException(422, "NIT mismatch"),
    );
    render(<CertificateSetupPage />);

    await pickCertificateAndFillForm();
    await user.click(
      screen.getByRole("button", { name: "Subir certificado" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /El servidor rechazó el certificado/,
      );
    });
  });

  it("shows the NETWORK error on unexpected upload failures", async () => {
    const user = userEvent.setup();
    mockUpload.mockRejectedValue(new TypeError("fetch failed"));
    render(<CertificateSetupPage />);

    await pickCertificateAndFillForm();
    await user.click(
      screen.getByRole("button", { name: "Subir certificado" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /No se pudo contactar el servidor/,
      );
    });
  });

  it("navigates home when the step is skipped", async () => {
    const user = userEvent.setup();
    render(<CertificateSetupPage />);

    await user.click(screen.getByRole("button", { name: "Lo haré después" }));

    expect(mockDispatch).toHaveBeenCalledWith(navigateToHome());
  });

  it("surfaces the client-side validation code from the store", () => {
    setupHook({ uploadErrorCode: "PASSWORD_REQUIRED" });
    render(<CertificateSetupPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Ingresa la contraseña del certificado/,
    );
  });
});