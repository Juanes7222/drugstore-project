/**
 * Component tests for DianHabilitationChecklist — the six-step DIAN
 * habilitación expediente with its OPERANDO / EN TRÁMITE seal.
 *
 * Every step state is DERIVED, never hand-checked: the certificate step
 * reads certificateActive, steps 2–5 are proven en bloc by the existence
 * of the numbering resolution, and step 6 keeps its derived range banner.
 *
 * useCompanySetup is mocked at the hook boundary: store and hook behavior
 * are covered by the domain and hook suites, not here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DianHabilitationChecklist } from "./dian-habilitation-checklist";
import {
  useCompanySetup,
  type CompanyDraft,
  type UseCompanySetupResult,
} from "@/hooks/use-company-setup";

vi.mock("@/hooks/use-company-setup", () => ({
  useCompanySetup: vi.fn(),
}));

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
  resolutionNumber: null,
  resolutionDate: null,
  resolutionPrefix: "FE",
  resolutionRangeStart: "1000",
  resolutionRangeEnd: "1999",
  ...overrides,
});

const makeHookResult = (
  overrides: Partial<UseCompanySetupResult> = {},
): UseCompanySetupResult => ({
  status: "needs-setup",
  draft: makeDraft(),
  parsedFromRut: null,
  isResolving: false,
  uploadRutFile: vi.fn(),
  submitCompany: vi.fn(),
  reset: vi.fn(),
  certificateActive: null,
  ...overrides,
});

const setupHook = (overrides: Partial<UseCompanySetupResult> = {}): void => {
  vi.mocked(useCompanySetup).mockReturnValue(makeHookResult(overrides));
};

const OPERATING_DRAFT = makeDraft({
  resolutionNumber: "18760000001234",
  resolutionDate: "2026-01-15",
});

const CERT_TITLE = "1. Certificado digital de firma";

/** Titles of steps 2–5 — proven done en bloc by the saved resolution. */
const PROCESS_STEP_TITLES = [
  "2. Registro como facturador",
  "3. Modo de operación",
  "4. Set de documentos de prueba",
  "5. Fecha de inicio de facturación",
];

const CERT_PENDING_HINT =
  "Carga tu certificado digital en la plataforma o solicita asistencia.";

const getStepItem = (title: string): HTMLElement =>
  screen.getByText(title).closest("li") as HTMLElement;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DianHabilitationChecklist", () => {
  beforeEach(() => {
    vi.mocked(useCompanySetup).mockReset();
  });

  describe("step list", () => {
    it("renders the six numbered habilitation steps in order", () => {
      setupHook();

      render(<DianHabilitationChecklist />);

      expect(
        screen.getByRole("list", {
          name: "Expediente del trámite de habilitación: 6 pasos en orden obligatorio",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(CERT_TITLE)).toBeInTheDocument();
      expect(
        screen.getByText("2. Registro como facturador"),
      ).toBeInTheDocument();
      expect(screen.getByText("3. Modo de operación")).toBeInTheDocument();
      expect(
        screen.getByText("4. Set de documentos de prueba"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("5. Fecha de inicio de facturación"),
      ).toBeInTheDocument();
      // Step 6 carries its numeral in the casilla, not in the heading.
      const rangeItem = getStepItem("Rango de numeración autorizado");
      expect(within(rangeItem).getByText("6")).toBeInTheDocument();
    });

    it("renders no manual controls — every step is informative text", () => {
      setupHook();

      render(<DianHabilitationChecklist />);

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(
        screen.queryByRole("button", { name: "Marcar como hecho" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("seal", () => {
    it("stamps En trámite while the draft has no resolution number", () => {
      setupHook({ draft: makeDraft({ resolutionNumber: null }) });

      render(<DianHabilitationChecklist />);

      expect(screen.getByRole("status", { name: "En trámite" })).toBeVisible();
    });

    it("stamps Operando once the draft carries a resolution number", () => {
      setupHook({ draft: OPERATING_DRAFT });

      render(<DianHabilitationChecklist />);

      expect(
        screen.getByRole("status", { name: "Operando" }),
      ).toBeVisible();
    });
  });

  describe("certificate step", () => {
    it.each([
      ["inactive", false],
      ["unknown", null],
    ])(
      "stays pending with the loading hint while the certificate is %s",
      (_label, certificateActive) => {
        setupHook({ certificateActive });

        render(<DianHabilitationChecklist />);

        const certItem = getStepItem(CERT_TITLE);
        expect(within(certItem).getByText("Pendiente")).toBeInTheDocument();
        expect(
          within(certItem).getByText(CERT_PENDING_HINT),
        ).toBeInTheDocument();
      },
    );

    it("turns done automatically once an ACTIVE certificate is reported", () => {
      setupHook({ certificateActive: true });

      render(<DianHabilitationChecklist />);

      const certItem = getStepItem(CERT_TITLE);
      expect(
        within(certItem).getByText("Completado automáticamente"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(CERT_PENDING_HINT),
      ).not.toBeInTheDocument();
    });
  });

  describe("process steps two to five", () => {
    it("are proven done en bloc once the draft carries a resolution", () => {
      setupHook({ draft: OPERATING_DRAFT, certificateActive: false });

      render(<DianHabilitationChecklist />);

      for (const title of PROCESS_STEP_TITLES) {
        expect(
          within(getStepItem(title)).getByText(
            "Completado automáticamente",
          ),
        ).toBeInTheDocument();
      }
      // Without an active certificate, step 1 stays pending on its own.
      expect(
        within(getStepItem(CERT_TITLE)).getByText("Pendiente"),
      ).toBeInTheDocument();
    });

    it("stay pending while there is no numbering resolution", () => {
      setupHook({ certificateActive: true });

      render(<DianHabilitationChecklist />);

      for (const title of PROCESS_STEP_TITLES) {
        expect(
          within(getStepItem(title)).getByText("Pendiente"),
        ).toBeInTheDocument();
      }
    });
  });

  describe("numbering-range step", () => {
    it("shows the pending copy while there is no resolution", () => {
      setupHook();

      render(<DianHabilitationChecklist />);

      expect(
        screen.getByText(
          "Tu software lo solicita a DIAN automáticamente cuando completes tu certificado y habilitación.",
        ),
      ).toBeInTheDocument();
    });

    it("shows Obtenido automáticamente with prefix and range in font-data when operating", () => {
      setupHook({ draft: OPERATING_DRAFT });

      render(<DianHabilitationChecklist />);

      expect(screen.getByText("Obtenido automáticamente")).toBeInTheDocument();
      expect(screen.getByText("Prefijo FE")).toBeInTheDocument();
      expect(screen.getByText("Rango 1000–1999")).toBeInTheDocument();
      const banner = screen.getByText("Prefijo FE").closest("p");
      expect(banner).toHaveClass("font-data");
    });
  });

  describe("external links", () => {
    it.each([
      ["Instructivo de certificados digitales"],
      ["Abrir portal de Habilitación"],
      ["Actualizar el RUT en MUISCA"],
      ["Instructivo oficial de registro y habilitación"],
    ])("opens %s in a new tab with noopener noreferrer", (name) => {
      setupHook();

      render(<DianHabilitationChecklist />);

      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("footer", () => {
    it("offers assisted support by email and the official DIAN guide", () => {
      setupHook();

      render(<DianHabilitationChecklist />);

      const support = screen.getByRole("link", { name: "Solicitar asistencia" });
      expect(support).toHaveAttribute(
        "href",
        "mailto:soporte@drugstore-pos.com",
      );
      const guide = screen.getByRole("link", {
        name: "Instructivo oficial de registro y habilitación",
      });
      expect(guide).toHaveAttribute(
        "href",
        "https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/instructivo-de-registro-y-habilitacion-en-factura-electronica-dian/",
      );
    });
  });
});
