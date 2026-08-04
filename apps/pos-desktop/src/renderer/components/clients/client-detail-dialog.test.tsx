/**
 * Component tests for ClientDetailDialog.
 *
 * Covers: rendering nothing when closed, client identity (name, document,
 * email, phone), dashes for missing optional fields, active/inactive status
 * badges, and the edit hand-off / Esc-to-close interactions.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientDetailDialog } from "./client-detail-dialog";
import type { ClientSearchResult } from "../../../domain/clients/clients.service";

// i18n singleton initialized via vitest.setup.ts (Spanish by default)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClient(
  overrides: Partial<ClientSearchResult> = {},
): ClientSearchResult {
  return {
    id: "client-1",
    fullName: "María Gómez",
    identificationType: "CC",
    identificationNumber: "1023456789",
    email: "maria@example.com",
    phone: "3001234567",
    address: "Calle 12 #34-56",
    municipality: "Bogotá",
    department: "Cundinamarca",
    isActive: true,
    createdAt: new Date("2026-07-15T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    ...overrides,
  };
}

function setup(client: ClientSearchResult | null) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  render(
    <ClientDetailDialog client={client} onClose={onClose} onEdit={onEdit} />,
  );
  return { onClose, onEdit };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ClientDetailDialog", () => {
  describe("open state", () => {
    it("renders nothing when client is null", () => {
      setup(null);

      expect(screen.queryByText("María Gómez")).not.toBeInTheDocument();
    });

    it("renders the client identity when open", () => {
      setup(makeClient());

      // Modal eyebrow heading + identity
      expect(screen.getByText("Detalles del cliente")).toBeInTheDocument();
      expect(screen.getByText("María Gómez")).toBeInTheDocument();
      expect(screen.getByText("CC")).toBeInTheDocument();
      expect(screen.getByText("1023456789")).toBeInTheDocument();
      expect(screen.getByText("maria@example.com")).toBeInTheDocument();
      expect(screen.getByText("3001234567")).toBeInTheDocument();
      expect(screen.getByText("Calle 12 #34-56")).toBeInTheDocument();
      expect(screen.getByText("Bogotá, Cundinamarca")).toBeInTheDocument();
    });
  });

  describe("optional fields", () => {
    it("renders dashes for missing optional fields", () => {
      setup(
        makeClient({
          email: null,
          phone: null,
          address: null,
          municipality: null,
          department: null,
        }),
      );

      // Email, phone, address, and city all fall back to a dash.
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("status badge", () => {
    it("shows the active badge for an active client", () => {
      setup(makeClient({ isActive: true }));

      expect(screen.getByText("Activo")).toBeInTheDocument();
      expect(screen.queryByText("Inactivo")).not.toBeInTheDocument();
    });

    it("shows the inactive badge for an inactive client", () => {
      setup(makeClient({ isActive: false }));

      expect(screen.getByText("Inactivo")).toBeInTheDocument();
      expect(screen.queryByText("Activo")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("calls onEdit with the client when the edit button is clicked", async () => {
      const user = userEvent.setup();
      const client = makeClient();
      const { onEdit } = setup(client);

      await user.click(screen.getByRole("button", { name: "Editar" }));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith(client);
    });

    it("calls onClose when Escape is pressed", async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeClient());

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when the X button is clicked", async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeClient());

      await user.click(screen.getAllByRole("button", { name: "Cerrar" })[0]);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
