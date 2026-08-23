/**
 * Component tests for CompanySetupEntrySection — the admin-menu card that
 * shows the saved issuer profile and opens the company-setup wizard.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanySetupEntrySection } from "./company-setup-entry.section";

describe("CompanySetupEntrySection", () => {
  it("shows the NIT and razón social of the saved profile with an edit action", () => {
    render(
      <CompanySetupEntrySection
        nit="900.123.456"
        name="FARMACIA LOS ANDES S.A.S."
        isConfigured
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("region", {
        name: "Datos de la empresa (facturación electrónica)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("900.123.456")).toBeInTheDocument();
    expect(screen.getByText("FARMACIA LOS ANDES S.A.S.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("opens the company-setup wizard when the CTA is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <CompanySetupEntrySection
        nit="900.123.456"
        name="FARMACIA LOS ANDES S.A.S."
        isConfigured
        onOpen={onOpen}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("invites the first-time setup when no profile is saved", () => {
    render(
      <CompanySetupEntrySection
        nit={null}
        name={null}
        isConfigured={false}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Aún no se han configurado los datos del emisor. Configúralos para poder facturar electrónicamente.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Configurar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("900.123.456")).not.toBeInTheDocument();
  });
});
