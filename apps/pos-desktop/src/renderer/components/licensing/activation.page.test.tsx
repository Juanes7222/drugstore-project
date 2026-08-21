/**
 * Component tests for ActivationPage.
 *
 * Covers: form rendering, auto-formatting, offline warning, submit flow,
 * error handling, the already-activated redirect, the pending-code banner,
 * the plans CTA, and the lost-code recovery panel.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { ActivationPage } from "./activation.page";
import {
  ActivationFailedException,
  AlreadyActivatedException,
} from "../../../domain/licensing/exceptions";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockActivate = vi.hoisted(() => vi.fn());
const mockRecover = vi.hoisted(() => vi.fn());
const mockUseOnlineStatus = vi.hoisted(() => vi.fn(() => true));
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock("../../../domain/licensing/license.service", () => ({
  createLicenseService: vi.fn(() => ({
    activate: mockActivate,
    checkIn: vi.fn(),
    getStatus: vi.fn().mockReturnValue(LicenseStatus.ACTIVE),
    getSummary: vi.fn(),
    refreshStatus: vi.fn(),
    requireValidLicense: vi.fn(),
    validateTokenLocally: vi.fn(),
    recoverActivationCodes: mockRecover,
  })),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: mockUseOnlineStatus,
}));

// The page dispatches Redux actions (plans CTA); there is no Provider in
// these tests, so stub the hooks like App-level tests do.
vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => undefined,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setLicenseStatus(status: LicenseStatus): void {
  const baseData = {
    activationToken: "token",
    expiresAt: "2027-01-01T00:00:00.000Z",
    subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
    plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
    location: null,
    workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
    hardwareFingerprint: "fp-001",
  };

  switch (status) {
    case LicenseStatus.ACTIVE:
      useLicenseStore.getState().setActivated(baseData);
      return;
    case LicenseStatus.GRACE_PERIOD:
      useLicenseStore.getState().setActivated(baseData);
      useLicenseStore.getState().setGracePeriod(5);
      return;
    case LicenseStatus.LOCKED:
      useLicenseStore.getState().setLocked();
      return;
    case LicenseStatus.REVOKED:
      useLicenseStore.getState().setRevoked();
      return;
    default:
      // UNACTIVATED — already the default
      useLicenseStore.getState().reset();
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ActivationPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.getState().reset();
    mockActivate.mockReset();
    mockRecover.mockReset();
    mockUseOnlineStatus.mockReturnValue(true);
    mockDispatch.mockReset();
  });

  // -----------------------------------------------------------------------
  // Redirection guard
  // -----------------------------------------------------------------------

  describe("when already activated", () => {
    it.each([LicenseStatus.ACTIVE, LicenseStatus.GRACE_PERIOD, LicenseStatus.LOCKED, LicenseStatus.REVOKED])(
      "shows redirect message when status is %s",
      (status) => {
        setLicenseStatus(status);
        render(<ActivationPage />);

        expect(
          screen.getByText("Redirigiendo al sistema..."),
        ).toBeInTheDocument();
      },
    );

    it("does not render the activation form when already activated", () => {
      setLicenseStatus(LicenseStatus.ACTIVE);
      render(<ActivationPage />);

      expect(
        screen.queryByRole("button", { name: /ACTIVAR/i }),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Activation form — UNACTIVATED
  // -----------------------------------------------------------------------

  describe("activation form", () => {
    it("renders the activation form when status is UNACTIVATED", () => {
      render(<ActivationPage />);

      expect(
        screen.getByRole("heading", { name: /Active su punto de venta/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /ACTIVAR/i }),
      ).toBeInTheDocument();
    });

    it("renders an activation code input with auto-format placeholder", () => {
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      expect(codeInput).toBeInTheDocument();
      expect(codeInput).toHaveAttribute("placeholder", "ABCD-EFGH-IJKL");
      expect(codeInput).toHaveAttribute("maxLength", "14");
    });

    it("renders a workstation name input", () => {
      render(<ActivationPage />);

      const wsInput = screen.getByLabelText(/Nombre del puesto/i);
      expect(wsInput).toBeInTheDocument();
    });

    it("renders location fields on a fresh install", () => {
      render(<ActivationPage />);

      expect(
        screen.getByText("Datos del local"),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Nombre del local"),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Dirección del local"),
      ).toBeInTheDocument();
    });

    it("disables the submit button when the code is empty", () => {
      render(<ActivationPage />);

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      expect(submitButton).toBeDisabled();
    });
  });

  // -----------------------------------------------------------------------
  // Code auto-formatting
  // -----------------------------------------------------------------------

  describe("code auto-formatting", () => {
    it("formats input as XXXX-XXXX-XXXX as the user types", () => {
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      expect(codeInput).toHaveValue("ABCD-EFGH");
    });

    it("enables submit when the code has at least 8 characters", () => {
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      expect(submitButton).not.toBeDisabled();
    });
  });

  // -----------------------------------------------------------------------
  // Pending activation code — code obtained from an approved checkout
  // -----------------------------------------------------------------------

  describe("pending activation code", () => {
    it("prefills the activation code input with the formatted pending code", () => {
      useLicenseStore.getState().setPendingActivationCode("ABCDEFGH1234");
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      expect(codeInput).toHaveValue("ABCD-EFGH-1234");
    });

    it("shows the pending-code banner with the formatted code when a pending code exists", () => {
      useLicenseStore.getState().setPendingActivationCode("abcdEFGHijkl");
      render(<ActivationPage />);

      expect(screen.getByRole("status")).toHaveTextContent(/Pago aprobado/i);
      expect(screen.getByText("ABCD-EFGH-IJKL")).toBeInTheDocument();
    });

    it("does not show the pending-code banner when there is no pending code", () => {
      render(<ActivationPage />);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Pago aprobado/i),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Plans CTA — self-service purchase entry point
  // -----------------------------------------------------------------------

  describe("plans CTA", () => {
    it("dispatches setActiveScreen('licensing-plans') when clicked", () => {
      render(<ActivationPage />);

      const cta = screen.getByRole("button", {
        name: /Ver planes y suscripción/i,
      });
      expect(cta).not.toBeDisabled();

      fireEvent.click(cta);

      expect(mockDispatch).toHaveBeenCalledWith(
        setActiveScreen("licensing-plans"),
      );
    });

    it("is disabled with an offline hint when offline", () => {
      mockUseOnlineStatus.mockReturnValue(false);
      render(<ActivationPage />);

      const cta = screen.getByRole("button", {
        name: /Ver planes y suscripción/i,
      });
      expect(cta).toBeDisabled();
      expect(
        screen.getByText(/Necesita conexión a internet para comprar un plan/i),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Offline warning
  // -----------------------------------------------------------------------

  describe("offline behavior", () => {
    it("shows an offline warning banner when the browser is offline", () => {
      mockUseOnlineStatus.mockReturnValue(false);
      render(<ActivationPage />);

      expect(
        screen.getByText(/Sin conexión/i),
      ).toBeInTheDocument();
    });

    it("shows offline error on submit when offline", async () => {
      mockUseOnlineStatus.mockReturnValue(false);
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Necesita conexión a internet para activar por primera vez/i),
        ).toBeInTheDocument();
      });

      // Service should not have been called
      expect(mockActivate).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Submit flow
  // -----------------------------------------------------------------------

  describe("submit flow", () => {
    it("calls activate on the license service with the raw code", async () => {
      mockActivate.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        location: { id: "loc-1", name: "Farmacia Central" },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
      });

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCD-EFGH" } });

      const wsInput = screen.getByLabelText(/Nombre del puesto/i);
      fireEvent.change(wsInput, { target: { value: "Caja-01" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockActivate).toHaveBeenCalledWith(
          "ABCDEFGH", // raw code without dashes
          "Caja-01",
          undefined, // no location data when fields are empty
        );
      });
    });

    it("dispatches a license:activated event on success", async () => {
      const dispatchEvent = vi.spyOn(window, "dispatchEvent");

      mockActivate.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        location: { id: "loc-1", name: "Farmacia Central" },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
      });

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(dispatchEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "license:activated",
          }),
        );
      });
    });

    it("shows a success message after activation", async () => {
      mockActivate.mockResolvedValue({
        activationToken: "new-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subscription: { id: "s-1", status: "ACTIVE", currentPeriodEnd: "2027-01-01T00:00:00.000Z", gracePeriodDays: 7 },
        location: { id: "loc-1", name: "Farmacia Central" },
        plan: { id: "p-1", code: "BASIC", name: "Basic", features: [], maxLocations: 1, maxWorkstationsPerLocation: 1 },
        workstationActivation: { id: "w-1", workstationName: "Caja-01", activatedAt: "2026-01-01T00:00:00.000Z" },
      });

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Activación exitosa/i),
        ).toBeInTheDocument();
      });
    });

    it("shows a loading state while activating", async () => {
      // Keep the promise pending while we check the UI
      let resolvePromise!: (value: unknown) => void;
      mockActivate.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("Activando..."),
        ).toBeInTheDocument();
      });

      expect(submitButton).toBeDisabled();

      // Resolve to clean up
      resolvePromise({});
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("shows the exception message when ActivationFailedException is thrown", async () => {
      mockActivate.mockRejectedValue(new ActivationFailedException("Código inválido"));

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("Código inválido"),
        ).toBeInTheDocument();
      });
    });

    it("shows the exception message when AlreadyActivatedException is thrown", async () => {
      mockActivate.mockRejectedValue(new AlreadyActivatedException());

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/ya está activado/i),
        ).toBeInTheDocument();
      });
    });

    it("shows a generic error for unknown exceptions", async () => {
      mockActivate.mockRejectedValue(new DOMException("Algo salió mal"));

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Error al activar/i),
        ).toBeInTheDocument();
      });
    });

    it("clears the error when the user modifies the code input", async () => {
      mockActivate.mockRejectedValue(new ActivationFailedException("Código inválido"));

      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      fireEvent.change(codeInput, { target: { value: "ABCDEFGH" } });

      const submitButton = screen.getByRole("button", { name: /ACTIVAR/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Código inválido")).toBeInTheDocument();
      });

      // Modify the code
      fireEvent.change(codeInput, { target: { value: "ABCDEFGHIJ" } });

      expect(
        screen.queryByText("Código inválido"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Code recovery — lost activation code after a self-service checkout
  // -----------------------------------------------------------------------

  describe("code recovery", () => {
    const toggleLink = () =>
      screen.getByRole("button", { name: /Perdiste tu código/ });
    const taxIdInput = () => screen.getByLabelText("NIT o cédula");
    const emailInput = () => screen.getByLabelText("Correo electrónico");

    const fillRecoveryForm = (taxId: string, email: string): void => {
      fireEvent.click(toggleLink());
      fireEvent.change(taxIdInput(), { target: { value: taxId } });
      fireEvent.change(emailInput(), { target: { value: email } });
      fireEvent.click(screen.getByRole("button", { name: "Recuperar código" }));
    };

    it("keeps the recovery panel hidden by default", () => {
      render(<ActivationPage />);

      expect(toggleLink()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });

    it("opens the recovery panel when the link is clicked", () => {
      render(<ActivationPage />);

      fireEvent.click(toggleLink());

      expect(toggleLink()).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("region", { name: "Recuperar código de activación" }),
      ).toBeVisible();
    });

    it("closes the recovery panel when Cerrar is clicked", () => {
      render(<ActivationPage />);

      fireEvent.click(toggleLink());
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

      expect(toggleLink()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });

    it("shows inline errors and skips the service call when both fields are empty", () => {
      render(<ActivationPage />);

      fireEvent.click(toggleLink());
      fireEvent.click(screen.getByRole("button", { name: "Recuperar código" }));

      expect(screen.getAllByText("Este campo es obligatorio.")).toHaveLength(2);
      expect(taxIdInput()).toHaveAttribute("aria-invalid", "true");
      expect(emailInput()).toHaveAttribute("aria-invalid", "true");
      expect(mockRecover).not.toHaveBeenCalled();
    });

    it("shows an invalid-email error and skips the service call for a malformed email", () => {
      render(<ActivationPage />);

      fireEvent.click(toggleLink());
      fireEvent.change(taxIdInput(), { target: { value: "900123456" } });
      fireEvent.change(emailInput(), { target: { value: "not-an-email" } });
      fireEvent.click(screen.getByRole("button", { name: "Recuperar código" }));

      expect(
        screen.getByText("Ingrese un correo electrónico válido."),
      ).toBeInTheDocument();
      expect(mockRecover).not.toHaveBeenCalled();
    });

    it("renders recovered codes and applies the selected code to the store", async () => {
      mockRecover.mockResolvedValue([
        { code: "ABCDEFGH1234", expiresAt: "2026-12-31T15:00:00.000Z" },
      ]);

      render(<ActivationPage />);

      fillRecoveryForm("900123456", "test@pharmacy.com");

      await waitFor(() => {
        expect(screen.getByText("ABCD-EFGH-1234")).toBeInTheDocument();
      });
      expect(screen.getByText(/Vence: \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Usar este código" }));

      expect(useLicenseStore.getState().pendingActivationCode).toBe(
        "ABCDEFGH1234",
      );
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });

    it("shows the no-codes notice when the server returns an empty list", async () => {
      mockRecover.mockResolvedValue([]);

      render(<ActivationPage />);

      fillRecoveryForm("900123456", "test@pharmacy.com");

      await waitFor(() => {
        expect(
          screen.getByText("No encontramos códigos con esos datos"),
        ).toBeInTheDocument();
      });
    });

    it("shows a generic error notice without the raw exception message", async () => {
      mockRecover.mockRejectedValue(new Error("secret server detail"));

      render(<ActivationPage />);

      fillRecoveryForm("900123456", "test@pharmacy.com");

      await waitFor(() => {
        expect(
          screen.getByText(/No se pudo recuperar el código/),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByText("secret server detail"),
      ).not.toBeInTheDocument();
    });

    it("prefills the code input when a pending code arrives after mount", async () => {
      render(<ActivationPage />);

      const codeInput = screen.getByLabelText(/Código de activación/i);
      expect(codeInput).toHaveValue("");

      useLicenseStore.getState().setPendingActivationCode("ABCDEFGH1234");

      await waitFor(() => {
        expect(codeInput).toHaveValue("ABCD-EFGH-1234");
      });
    });
  });
});
