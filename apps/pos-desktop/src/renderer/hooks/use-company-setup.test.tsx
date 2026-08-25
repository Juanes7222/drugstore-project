/**
 * Unit tests for useCompanySetup — RUT upload with autofill, setup-status
 * resolution on mount, and profile submission.
 *
 * The pdf.js extractor module is mocked so the hook tests never load
 * pdfjs-dist; every upload test injects a fake extractor through the hook
 * options instead.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCompanySetup } from "./use-company-setup";
import { useCompanySetupStore } from "../../domain/company/company.store";
import {
  useLocalConfigStore,
  DEFAULT_SELLER_INFO,
} from "../../domain/configuration/local-config.store";
import {
  useLocalSessionStore,
  type LocalSession,
} from "../../domain/auth/local-session.store";
import type { CompanyDraft } from "../../domain/company";

vi.mock("../services/rut-pdf-extractor", () => ({
  extractRutPdfText: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixture helpers — independent modulo-11 DV computation.
// ---------------------------------------------------------------------------

const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

function computeVerificationDigit(nitDigits: string): string {
  let sum = 0;
  for (let i = 0; i < nitDigits.length; i += 1) {
    const digit = Number(nitDigits[nitDigits.length - 1 - i]);
    sum += digit * WEIGHTS[i % WEIGHTS.length];
  }
  const remainder = sum % 11;
  if (remainder === 0) return "0";
  const digit = 11 - remainder;
  return digit === 10 ? "9" : String(digit);
}

const NIT = "900123456";
const DV = computeVerificationDigit(NIT);

const makeRutText = (dv: string): string =>
  [
    "REPÚBLICA DE COLOMBIA",
    `NIT 900.123.456-${dv}`,
    "RAZÓN SOCIAL: FARMACIA LOS ANDES S.A.S.",
    "TIPO DE PERSONA: PERSONA JURÍDICA",
    "RÉGIMEN TRIBUTARIO DE RESPONSABILIDAD : RÉGIMEN COMÚN",
    "ACTIVIDAD ECONÓMICA PRINCIPAL: 4773",
    "MUNICIPIO: MEDELLÍN",
    "MUNICIPIO (CÓDIGO DANE): 05001",
    "DEPARTAMENTO: ANTIOQUIA",
    "DIRECCIÓN: CRA 45 # 12-34",
    "TELÉFONO: 604 444 5678",
    "CORREO ELECTRÓNICO: contacto@farmaciaandesa.com",
  ].join("\n");

// Regression fixture: the current DIAN numbered-box form, anonymized legal
// entity, exactly as the pdf.js line reconstruction hands it to the parser.
const NUMBERED_BOX_RUT_TEXT = [
  "Inscripción 0 1 2. Concepto",
  "4. Número de formulario 141270915303",
  "5. Número de Identificación Tributaria (NIT) 6. DV 12. Dirección seccional 14. Buzón electrónico",
  "Impuestos y Aduanas de Tuluá 2 1",
  "9 0 0 1 2 3 4 5 6 8",
  "IDENTIFICACIÓN",
  "24. Tipo de contribuyente 25. Tipo de documento 26. Número de Identificación",
  "2 1 3 9 0 0 1 2 3 4 5 6 Persona Jurídica",
  "28. País Lugar de expedición 29. Departamento 30. Ciudad/Municipio",
  "1 6 9 5 5001 COLOMBIA Antioquia Medellín",
  "31. Primer apellido 32. Segundo apellido 33. Primer nombre 34. Otros nombres",
  "35. Razón social DROGUERIA LA SALUD SAS",
  "36. Nombre comercial 37. Sigla",
  "UBICACIÓN",
  "38. País 40. Ciudad/Municipio 39. Departamento",
  "1 6 9 5 5001 COLOMBIA Antioquia Medellín",
  "41. Dirección principal",
  "CL 45 B # 12 - 34",
  "test@droguerialasalud.com 42. Correo electrónico",
  // The phone's ten box digits share the row with the label numbering; the
  // spaced run swallows the label's "2" and the parser anchors on the 3.
  "43. Código postal 44. Teléfono 1 45. Teléfono 2 3 1 2 4 5 6 7 8 9 0",
  "CLASIFICACIÓN",
  "Ocupación Actividad económica",
  "Actividad principal Actividad secundaria Otras actividades 52. Número",
  "establecimientos 51. Código 46. Código 47. Fecha inicio actividad 48. Código 49. Fecha inicio actividad 1 2",
  "50. Código",
  "5 8 2 0 2 0 2 6 0 8 1 7",
  "Responsabilidades, Calidades y Atributos",
  "53. Código 4 9",
  "37 - Responsable de IVA",
  "Firma autorizada:",
  "DROGUERIA LA SALUD SAS 984. Nombre",
  "Fecha generación documento PDF: 25-08-2026 09:51:03AM",
].join("\n");

const makeDraft = (overrides: Partial<CompanyDraft> = {}): CompanyDraft => ({
  nit: NIT,
  dv: DV,
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
  resolutionValidTo: "2031-01-15",
  resolutionPrefix: "FE",
  resolutionRangeStart: "1000",
  resolutionRangeEnd: "1999",
  ...overrides,
});

const makeSession = (accessToken: string): LocalSession => ({
  userId: "u-1",
  username: "owner",
  fullName: "Owner",
  displayName: "Owner",
  role: "OWNER",
  subscriptionId: "s-1",
  workstationId: "ws-1",
  accessToken,
  refreshToken: "",
  sessionId: "sess-1",
  sessionTrust: "SERVER_VERIFIED",
});

const makeRutFile = (): File =>
  new File(["%PDF-1.7 fake"], "rut.pdf", { type: "application/pdf" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCompanySetup", () => {
  beforeEach(() => {
    localStorage.clear();
    useCompanySetupStore.getState().reset();
    useLocalConfigStore.getState().updateSellerInfo(DEFAULT_SELLER_INFO);
    useLocalSessionStore.getState().clearSession();
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("uploadRutFile", () => {
    it("autofills a draft and stores it as parsedFromRut on a valid RUT", async () => {
      const extractor = vi.fn().mockResolvedValue(makeRutText(DV));
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test", extractor }),
      );

      const parseResult = await act(async () => {
        return result.current.uploadRutFile(makeRutFile());
      });

      expect(parseResult).toEqual({
        ok: true,
        draft: expect.objectContaining({ nit: NIT, dv: DV }),
      });
      const { draft } = parseResult as Extract<
        Awaited<ReturnType<typeof result.current.uploadRutFile>>,
        { ok: true }
      >;
      expect(draft.name).toBe("FARMACIA LOS ANDES S.A.S.");
      // The RUT never carries the resolution: the parsed draft must leave
      // resolutionValidTo unset so the wizard shows it empty for manual entry.
      expect(draft.resolutionValidTo).toBeUndefined();
      expect(useCompanySetupStore.getState().parsedFromRut?.nit).toBe(NIT);
      expect(useCompanySetupStore.getState().draft?.nit).toBe(NIT);
      expect(extractor).toHaveBeenCalledTimes(1);
    });

    it("returns UNPARSEABLE when the RUT has no verification digit", async () => {
      const extractor = vi
        .fn()
        .mockResolvedValue(
          "NIT: 900123456\nRAZÓN SOCIAL: FARMACIA LOS ANDES S.A.S.",
        );
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test", extractor }),
      );

      const parseResult = await act(async () => {
        return result.current.uploadRutFile(makeRutFile());
      });

      expect(parseResult).toEqual({ ok: false, errorCode: "UNPARSEABLE" });
      expect(useCompanySetupStore.getState().parsedFromRut).toBeNull();
    });

    it("returns UNPARSEABLE when the NIT does not verify against its DV", async () => {
      // The parser drops every field up front when no NIT+DV candidate
      // validates, so the hook never reaches its own INVALID_NIT_DV check.
      const wrongDv = DV === "9" ? "0" : "9";
      const extractor = vi.fn().mockResolvedValue(makeRutText(wrongDv));
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test", extractor }),
      );

      const parseResult = await act(async () => {
        return result.current.uploadRutFile(makeRutFile());
      });

      expect(parseResult).toEqual({ ok: false, errorCode: "UNPARSEABLE" });
    });

    it("autofills a complete draft from the current numbered-box RUT form", async () => {
      const extractor = vi.fn().mockResolvedValue(NUMBERED_BOX_RUT_TEXT);
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test", extractor }),
      );

      const parseResult = await act(async () => {
        return result.current.uploadRutFile(makeRutFile());
      });

      expect(parseResult).toEqual({
        ok: true,
        draft: expect.objectContaining({
          nit: NIT,
          dv: DV,
          name: "DROGUERIA LA SALUD SAS",
          regimen: "RESPONSABLE DE IVA",
          organizationType: "PERSONA JURÍDICA",
          ciiu: null,
          municipio: "MEDELLÍN",
          municipioCode: null,
          departamento: "ANTIOQUIA",
          address: "CL 45 B # 12 - 34",
          phone: "3124567890",
          email: "test@droguerialasalud.com",
          resolutionNumber: null,
          softwareId: null,
        }),
      });
      expect(
        useCompanySetupStore.getState().parsedFromRut?.phone,
      ).toBe("3124567890");
    });

    it("returns UNPARSEABLE when the extractor throws", async () => {
      const extractor = vi.fn().mockRejectedValue(new Error("pdf corrupt"));
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test", extractor }),
      );

      const parseResult = await act(async () => {
        return result.current.uploadRutFile(makeRutFile());
      });

      expect(parseResult).toEqual({ ok: false, errorCode: "UNPARSEABLE" });
    });
  });

  describe("initial status resolution", () => {
    it("resolves needs-setup from the placeholder seller info without a token", async () => {
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await waitFor(() => {
        expect(result.current.status).toBe("needs-setup");
      });
      expect(result.current.isResolving).toBe(false);
    });

    it("resolves complete from a configured local seller without a token", async () => {
      useLocalConfigStore.getState().updateSellerInfo({
        nit: "900.123.456",
        name: "FARMACIA LOS ANDES S.A.S.",
      });

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await waitFor(() => {
        expect(result.current.status).toBe("complete");
      });
    });

    it("fetches the server profile with a token and marks the company complete", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            nit: "900.123.456",
            verificationDigit: DV,
            businessName: "FARMACIA LOS ANDES S.A.S.",
            organizationType: "PERSONA JURÍDICA",
            taxRegime: "R-99-PJ",
            ciiu: "4773",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await waitFor(() => {
        expect(result.current.status).toBe("complete");
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://api.test/fiscal-dian/issuer-config",
        { headers: { Authorization: "Bearer tok-1" } },
      );
      expect(useCompanySetupStore.getState().draft?.nit).toBe(NIT);
    });

    it("hydrates the store draft with the resolution and softwareId from the server profile", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            nit: "900.123.456",
            verificationDigit: DV,
            businessName: "FARMACIA LOS ANDES S.A.S.",
            organizationType: "PERSONA JURÍDICA",
            taxRegime: "R-99-PJ",
            ciiu: "4773",
            municipio: "MEDELLÍN",
            municipioCode: "05001",
            department: "ANTIOQUIA",
            softwareId: "SW-42",
            resolution: {
              id: "res-1",
              resolutionNumber: "18760000001234",
              documentType: "FACTURA",
              prefix: "SETP",
              rangeFrom: 1000,
              rangeTo: 1999,
              validFrom: "2026-01-15",
              validTo: "2027-01-15",
              state: "ACTIVE",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await waitFor(() => {
        expect(result.current.status).toBe("complete");
      });

      const draft = useCompanySetupStore.getState().draft;
      expect(draft?.resolutionNumber).toBe("18760000001234");
      expect(draft?.resolutionDate).toBe("2026-01-15");
      expect(draft?.resolutionPrefix).toBe("SETP");
      expect(draft?.resolutionRangeStart).toBe("1000");
      expect(draft?.resolutionRangeEnd).toBe("1999");
      expect(draft?.softwareId).toBe("SW-42");
    });

    it("marks needs-setup when the server has no profile (404)", async () => {
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not Found", { status: 404 }),
      );

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await waitFor(() => {
        expect(result.current.status).toBe("needs-setup");
      });
    });
  });

  describe("submitCompany", () => {
    it("submits the draft and flips the store to complete", async () => {
      useCompanySetupStore.getState().setStatus("needs-setup");
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await act(async () => {
        await result.current.submitCompany(makeDraft());
      });

      expect(useCompanySetupStore.getState().status).toBe("complete");
      const patchCall = fetchSpy.mock.calls[0];
      expect(patchCall[0]).toBe("http://api.test/fiscal-dian/issuer-config");
      expect((patchCall[1] as RequestInit).method).toBe("PATCH");
      expect(JSON.parse((patchCall[1] as RequestInit).body as string)).toEqual(
        expect.objectContaining({
          nit: NIT,
          verificationDigit: DV,
          businessName: "FARMACIA LOS ANDES S.A.S.",
          taxRegime: "R-99-PJ",
        }),
      );
    });

    it("sends the session workstation id in the allocation POST body", async () => {
      useCompanySetupStore.getState().setStatus("needs-setup");
      useLocalSessionStore.getState().setSession(makeSession("tok-1"));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_input, init) => {
          if ((init as RequestInit)?.method === "PATCH") {
            return new Response(JSON.stringify({}), { status: 200 });
          }
          return new Response(JSON.stringify({ id: "res-1" }), { status: 200 });
        });

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      await act(async () => {
        await result.current.submitCompany(makeDraft());
      });

      const allocationCall = fetchSpy.mock.calls.find(
        ([url]) =>
          url === "http://api.test/fiscal-dian/resolution-allocations",
      );
      expect(allocationCall).toBeDefined();
      expect(allocationCall![0]).toBe(
        "http://api.test/fiscal-dian/resolution-allocations",
      );
      expect(
        JSON.parse((allocationCall![1] as RequestInit).body as string),
      ).toEqual({
        resolutionId: "res-1",
        workstationId: "ws-1",
        rangeFrom: 1000,
        rangeTo: 1999,
      });
    });
  });

  describe("certificate status", () => {
    it("exposes certificateActive from the company store", () => {
      useCompanySetupStore.getState().setCertificateActive(true);

      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      expect(result.current.certificateActive).toBe(true);
    });

    it("exposes a false certificateActive once the server reports NONE", async () => {
      useCompanySetupStore.getState().setCertificateActive(true);
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      act(() => {
        useCompanySetupStore.getState().setCertificateActive(false);
      });

      expect(result.current.certificateActive).toBe(false);
    });

    it("starts with an unknown certificateActive on a fresh setup", () => {
      const { result } = renderHook(() =>
        useCompanySetup({ baseUrl: "http://api.test" }),
      );

      expect(result.current.certificateActive).toBeNull();
    });
  });
});
