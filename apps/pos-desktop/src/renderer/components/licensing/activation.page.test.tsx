/**
 * Component tests for ActivationPage.
 *
 * Covers: form rendering, auto-formatting, offline warning, submit flow,
 * error handling, and the already-activated redirect.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LicenseStatus } from "@pharmacy/shared-types";
import { useLicenseStore } from "../../../domain/licensing/license.store";
import { ActivationPage } from "./activation.page";
import {
  ActivationFailedException,
  AlreadyActivatedException,
} from "../../../domain/licensing/exceptions";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockActivate = vi.hoisted(() => vi.fn());
const mockUseOnlineStatus = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../domain/licensing/license.service", () => ({
  createLicenseService: vi.fn(() => ({
    activate: mockActivate,
    checkIn: vi.fn(),
    getStatus: vi.fn().mockReturnValue(LicenseStatus.ACTIVE),
    getSummary: vi.fn(),
    refreshStatus: vi.fn(),
    requireValidLicense: vi.fn(),
    validateTokenLocally: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: mockUseOnlineStatus,
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
    mockUseOnlineStatus.mockReturnValue(true);
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
        screen.getByRole("heading", { name: /Active tu punto de venta/i }),
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
          screen.getByText(/Necesitás conexión a internet/i),
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
});
