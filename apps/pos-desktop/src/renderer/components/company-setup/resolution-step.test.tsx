/**
 * Component tests for ResolutionStep — the DIAN numbering-resolution form.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResolutionStep } from "./resolution-step";
import type { CompanyDraft } from "@/hooks/use-company-setup";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeDraft = (overrides: Partial<CompanyDraft> = {}): CompanyDraft => ({
  nit: "900123456",
  dv: "8",
  name: "FARMACIA LOS ANDES S.A.S.",
  regimen: "RÉGIMEN COMÚN",
  organizationType: "PERSONA JURÍDICA",
  ciiu: "4773",
  municipio: "MEDELLÍN",
  municipioCode: "05001",
  departamento: "ANTIOQUIA",
  address: "CRA 45 # 12-34",
  phone: "604 444 5678",
  email: "contacto@farmaciaandesa.com",
  resolutionNumber: "18760000001234",
  resolutionDate: "2026-01-15",
  resolutionPrefix: "FE",
  resolutionRangeStart: "1000",
  resolutionRangeEnd: "1999",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResolutionStep", () => {
  it("renders all resolution fields from the draft", () => {
    render(<ResolutionStep draft={makeDraft()} onFieldChange={vi.fn()} />);

    expect(
      screen.getByRole("region", { name: "Resolución de numeración" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Número de resolución")).toHaveValue(
      "18760000001234",
    );
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-01-15");
    expect(screen.getByLabelText("Prefijo")).toHaveValue("FE");
    expect(screen.getByLabelText("Desde")).toHaveValue("1000");
    expect(screen.getByLabelText("Hasta")).toHaveValue("1999");
    expect(
      screen.getByText("Rango de numeración autorizado para tus facturas."),
    ).toBeInTheDocument();
  });

  it("renders nullable resolution fields as empty inputs", () => {
    render(
      <ResolutionStep
        draft={makeDraft({
          resolutionNumber: null,
          resolutionDate: null,
          resolutionRangeStart: null,
          resolutionRangeEnd: null,
        })}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Número de resolución")).toHaveValue("");
    expect(screen.getByLabelText("Fecha")).toHaveValue("");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
  });

  it("renders the resolution valid-to date from the draft", () => {
    render(
      <ResolutionStep
        draft={makeDraft({ resolutionValidTo: "2031-01-15" })}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Vigencia hasta")).toHaveValue("2031-01-15");
  });

  it("renders a null resolution valid-to date as an empty input", () => {
    render(
      <ResolutionStep
        draft={makeDraft({ resolutionValidTo: null })}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Vigencia hasta")).toHaveValue("");
  });

  it("reports resolution valid-to edits with the resolutionValidTo field key", () => {
    const onFieldChange = vi.fn();
    render(
      <ResolutionStep
        draft={makeDraft({ resolutionValidTo: null })}
        onFieldChange={onFieldChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Vigencia hasta"), {
      target: { value: "2031-06-30" },
    });

    expect(onFieldChange).toHaveBeenCalledWith("resolutionValidTo", "2031-06-30");
  });

  it("renders the software ID from the draft", () => {
    render(
      <ResolutionStep
        draft={makeDraft({ softwareId: "SW-42" })}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ID de software DIAN")).toHaveValue("SW-42");
    expect(
      screen.getByText(
        "Se completa cuando la habilitación del software esté lista — déjalo vacío si no lo tienes.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a null software ID as an empty input", () => {
    render(
      <ResolutionStep
        draft={makeDraft({ softwareId: null })}
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ID de software DIAN")).toHaveValue("");
  });

  it("reports software ID edits with the softwareId field key", () => {
    const onFieldChange = vi.fn();
    render(
      <ResolutionStep
        draft={makeDraft({ softwareId: null })}
        onFieldChange={onFieldChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("ID de software DIAN"), {
      target: { value: "SW-99" },
    });

    expect(onFieldChange).toHaveBeenCalledWith("softwareId", "SW-99");
  });

  it("hints the expected prefix format in the placeholder", () => {
    render(<ResolutionStep draft={makeDraft()} onFieldChange={vi.fn()} />);

    expect(screen.getByLabelText("Prefijo")).toHaveAttribute(
      "placeholder",
      "Ej.: SETP",
    );
  });

  it("reports every edit with its field key", () => {
    const onFieldChange = vi.fn();
    render(
      <ResolutionStep
        draft={makeDraft({ resolutionNumber: null })}
        onFieldChange={onFieldChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Número de resolución"), {
      target: { value: "1876" },
    });
    fireEvent.change(screen.getByLabelText("Prefijo"), {
      target: { value: "FEX" },
    });
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "10001" },
    });
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "19999" },
    });

    expect(onFieldChange).toHaveBeenCalledWith("resolutionNumber", "1876");
    expect(onFieldChange).toHaveBeenCalledWith("resolutionPrefix", "FEX");
    expect(onFieldChange).toHaveBeenCalledWith("resolutionRangeStart", "10001");
    expect(onFieldChange).toHaveBeenCalledWith("resolutionRangeEnd", "19999");
  });

  it("reports date edits with the date field key", () => {
    const onFieldChange = vi.fn();
    render(
      <ResolutionStep
        draft={makeDraft({ resolutionDate: null })}
        onFieldChange={onFieldChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-02-01" },
    });

    expect(onFieldChange).toHaveBeenCalledWith("resolutionDate", "2026-02-01");
  });
});
