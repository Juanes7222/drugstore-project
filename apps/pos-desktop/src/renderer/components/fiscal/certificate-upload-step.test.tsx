/**
 * Component tests for CertificateUploadStep — the DIAN certificate form:
 * file picker, credential ledger, the seven inline error states, uploading
 * feedback, the security promise (password never leaks into attributes) and
 * the configured/finish view.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CertificateUploadStep,
  type CertificateStepErrorCode,
  type CertificateUploadStepProps,
} from "./certificate-upload-step";
import type { CertificateUploadInput } from "../../../domain/fiscal";

const makeProps = (
  overrides: Partial<CertificateUploadStepProps> = {},
): CertificateUploadStepProps => ({
  isConfigured: false,
  subjectCn: null,
  validTo: null,
  isUploading: false,
  errorCode: null,
  onUpload: vi.fn(),
  onClearError: vi.fn(),
  onSkip: vi.fn(),
  onFinish: vi.fn(),
  ...overrides,
});

const ERROR_MESSAGES: Record<CertificateStepErrorCode, RegExp> = {
  INVALID_FILE_TYPE: /debe ser un certificado .pfx o .p12/,
  FILE_TOO_LARGE: /supera el tamaño máximo \(3 MB\)/,
  PASSWORD_REQUIRED: /Ingresa la contraseña del certificado/,
  SECURITY_CODE_TOO_SHORT: /al menos 10 caracteres/,
  OFFLINE: /No hay conexión a internet/,
  SERVER_REJECTED: /El servidor rechazó el certificado/,
  NETWORK: /No se pudo contactar el servidor/,
};

const makeFile = (): File => new File(["abc"], "cert.pfx");

/**
 * First attribute (outside the input's own value) that carries the secret.
 * React mirrors controlled-input values into the value attribute, so the
 * password legitimately appears there — everywhere else is a leak.
 */
function findSecretAttributeLeak(
  container: HTMLElement,
  secret: string,
): string | null {
  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "value") continue;
      if (attribute.value.includes(secret)) {
        return `${element.tagName}[${attribute.name}]`;
      }
    }
  }
  return null;
}

describe("CertificateUploadStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("form view", () => {
    it("renders the file picker and the credential ledger with associated labels", () => {
      render(<CertificateUploadStep {...makeProps()} />);

      expect(
        screen.getByRole("button", { name: /Seleccionar archivo .pfx o .p12/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
      ).toHaveAttribute("accept", ".pfx,.p12");
      expect(
        screen.getByLabelText("Contraseña del certificado"),
      ).toHaveAttribute("type", "password");
      expect(
        screen.getByLabelText("Código de seguridad del software"),
      ).toBeInTheDocument();
    });

    it("keeps the upload button disabled until a file is picked", async () => {
      const user = userEvent.setup();
      render(<CertificateUploadStep {...makeProps()} />);

      expect(
        screen.getByRole("button", { name: "Subir certificado" }),
      ).toBeDisabled();

      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        makeFile(),
      );

      expect(
        screen.getByRole("button", { name: "Subir certificado" }),
      ).not.toBeDisabled();
    });

    it("shows the picked file name and size in the file target", async () => {
      const user = userEvent.setup();
      render(<CertificateUploadStep {...makeProps()} />);

      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        new File(["abc"], "cert.pfx"),
      );

      expect(screen.getByText("cert.pfx")).toBeInTheDocument();
      expect(screen.getByText("3 B")).toBeInTheDocument();
    });

    it("clears the current error when a new file is picked", async () => {
      const user = userEvent.setup();
      const onClearError = vi.fn();
      render(
        <CertificateUploadStep {...makeProps({ onClearError })} />,
      );

      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        makeFile(),
      );

      expect(onClearError).toHaveBeenCalledTimes(1);
    });

    it("clears the current error when the user types the password", async () => {
      const user = userEvent.setup();
      const onClearError = vi.fn();
      render(<CertificateUploadStep {...makeProps({ onClearError })} />);

      await user.type(
        screen.getByLabelText("Contraseña del certificado"),
        "clave",
      );

      expect(onClearError).toHaveBeenCalled();
    });

    it("delivers the file, the typed password and the security code to onUpload", async () => {
      const user = userEvent.setup();
      const onUpload = vi.fn();
      render(<CertificateUploadStep {...makeProps({ onUpload })} />);

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
      await user.click(
        screen.getByRole("button", { name: "Subir certificado" }),
      );

      expect(onUpload).toHaveBeenCalledTimes(1);
      const payload = onUpload.mock.calls[0][0] as CertificateUploadInput;
      expect(payload.file.name).toBe("cert.pfx");
      expect(payload.password).toBe("clave-segura");
      expect(payload.softwareSecurityCode).toBe("ABCDEFGHIJ");
    });

    it("never places the password in a data attribute or any persistible attribute", async () => {
      const user = userEvent.setup();
      const password = "clave-segura";
      const onUpload = vi.fn();
      const { container } = render(
        <CertificateUploadStep {...makeProps({ onUpload })} />,
      );

      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        makeFile(),
      );
      await user.type(
        screen.getByLabelText("Contraseña del certificado"),
        password,
      );

      expect(findSecretAttributeLeak(container, password)).toBeNull();
      expect(onUpload).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText("Contraseña del certificado"),
      ).toHaveAttribute("autocomplete", "new-password");
    });

    it("does not call onUpload before the user submits", async () => {
      const user = userEvent.setup();
      const onUpload = vi.fn();
      render(<CertificateUploadStep {...makeProps({ onUpload })} />);

      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        makeFile(),
      );

      expect(onUpload).not.toHaveBeenCalled();
    });
  });

  describe("error states", () => {
    it.each(Object.entries(ERROR_MESSAGES) as Array<[CertificateStepErrorCode, RegExp]>)(
      "renders the %s error as an alert",
      (code, message) => {
        render(<CertificateUploadStep {...makeProps({ errorCode: code })} />);

        expect(screen.getByRole("alert")).toHaveTextContent(message);
      },
    );

    it("renders no alert when there is no error", () => {
      render(<CertificateUploadStep {...makeProps()} />);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("uploading state", () => {
    it("disables the button and shows the uploading label with aria-busy", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<CertificateUploadStep {...makeProps()} />);
      await user.upload(
        screen.getByLabelText("Subir el archivo del certificado DIAN"),
        makeFile(),
      );

      rerender(
        <CertificateUploadStep
          {...makeProps({ isUploading: true, onUpload: vi.fn() })}
        />,
      );

      const button = screen.getByRole("button", {
        name: "Subiendo certificado...",
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("skip", () => {
    it("calls onSkip from the footer link", async () => {
      const user = userEvent.setup();
      const onSkip = vi.fn();
      render(<CertificateUploadStep {...makeProps({ onSkip })} />);

      await user.click(screen.getByRole("button", { name: "Lo haré después" }));

      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });

  describe("configured view", () => {
    it("shows the subject, the validity end and the finish button", async () => {
      const user = userEvent.setup();
      const onFinish = vi.fn();
      render(
        <CertificateUploadStep
          {...makeProps({
            isConfigured: true,
            subjectCn: "FARMACIA LOS ANDES S.A.S",
            validTo: "2027-01-01T00:00:00.000Z",
            onFinish,
          })}
        />,
      );

      expect(
        screen.getByRole("status"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Titular: FARMACIA LOS ANDES S.A.S/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Válido hasta/),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Contraseña del certificado"),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Continuar al sistema" }),
      );

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("falls back to an em dash when the validity date is missing", () => {
      render(
        <CertificateUploadStep
          {...makeProps({ isConfigured: true, subjectCn: null, validTo: null })}
        />,
      );

      expect(screen.getByText(/Válido hasta —/)).toBeInTheDocument();
    });
  });
});