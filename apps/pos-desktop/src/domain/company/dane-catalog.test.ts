/**
 * Unit tests for the DANE territorial catalog — catalog integrity, name
 * normalization and the code/name lookup helpers the company-setup flow
 * relies on for offline municipio resolution.
 */
import { describe, expect, it } from "vitest";
import {
  DANE_DEPARTAMENTOS,
  normalizeDaneName,
  findDaneDepartamento,
  findDaneMunicipio,
  findDaneMunicipioByName,
  isValidDaneMunicipioCode,
  isValidDaneDepartamentoCode,
  resolveDaneMunicipioCode,
} from "./dane-catalog";

describe("DANE_DEPARTAMENTOS", () => {
  it("contains the 33 Colombian departamentos", () => {
    expect(DANE_DEPARTAMENTOS).toHaveLength(33);
  });

  it("covers the full DIVIPOLA municipio set with unique 5-digit codes", () => {
    const municipios = DANE_DEPARTAMENTOS.flatMap((d) => d.municipios);
    const codes = municipios.map((m) => m.cod);

    expect(municipios).toHaveLength(1123);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((cod) => /^\d{5}$/.test(cod))).toBe(true);
  });

  it("includes Bogotá D.C. as a departamento and as a municipio", () => {
    const bogotaDepartamento = findDaneDepartamento("11");
    const bogotaMunicipio = findDaneMunicipio("11001");

    expect(bogotaDepartamento?.nombre).toBe("BOGOTÁ D.C.");
    expect(bogotaMunicipio?.municipio.nombre).toBe("BOGOTÁ D.C.");
  });
});

describe("normalizeDaneName", () => {
  it("strips accents and uppercases the input", () => {
    expect(normalizeDaneName("MEDELLÍN")).toBe("MEDELLIN");
    expect(normalizeDaneName("medellín")).toBe("MEDELLIN");
  });

  it("collapses whitespace and trims the input", () => {
    expect(normalizeDaneName("  BOGOTÁ   D.C. ")).toBe("BOGOTA D.C.");
  });
});

describe("findDaneDepartamento", () => {
  it("resolves Antioquia by its 2-digit code", () => {
    expect(findDaneDepartamento("05")?.nombre).toBe("ANTIOQUIA");
  });

  it("returns undefined for an unknown departamento code", () => {
    expect(findDaneDepartamento("00")).toBeUndefined();
  });
});

describe("findDaneMunicipio", () => {
  it("resolves Medellín under Antioquia by its 5-digit code", () => {
    const result = findDaneMunicipio("05001");

    expect(result?.municipio.nombre).toBe("MEDELLÍN");
    expect(result?.departamento.nombre).toBe("ANTIOQUIA");
  });

  it("resolves Bogotá D.C. by its 5-digit code", () => {
    const result = findDaneMunicipio("11001");

    expect(result?.municipio.nombre).toBe("BOGOTÁ D.C.");
    expect(result?.departamento.nombre).toBe("BOGOTÁ D.C.");
  });

  it("returns undefined for a code outside the catalog", () => {
    expect(findDaneMunicipio("99999")).toBeUndefined();
  });
});

describe("findDaneMunicipioByName", () => {
  it("matches an accented name in any case", () => {
    expect(findDaneMunicipioByName("MEDELLÍN")?.cod).toBe("05001");
    expect(findDaneMunicipioByName("medellin")?.cod).toBe("05001");
  });

  it("matches within a departamento scope", () => {
    expect(findDaneMunicipioByName("MEDELLÍN", "ANTIOQUIA")?.cod).toBe("05001");
  });

  it("returns undefined when the name exists but in a different departamento", () => {
    expect(
      findDaneMunicipioByName("MEDELLÍN", "VALLE DEL CAUCA"),
    ).toBeUndefined();
  });

  it("returns undefined when the name has no catalog match", () => {
    expect(findDaneMunicipioByName("PUEBLO INEXISTENTE")).toBeUndefined();
  });
});

describe("isValidDaneMunicipioCode", () => {
  it("accepts a real 5-digit DANE code", () => {
    expect(isValidDaneMunicipioCode("05001")).toBe(true);
  });

  it("rejects a well-formed code outside the catalog", () => {
    expect(isValidDaneMunicipioCode("99999")).toBe(false);
  });

  it("rejects codes with the wrong format", () => {
    expect(isValidDaneMunicipioCode("1234")).toBe(false);
    expect(isValidDaneMunicipioCode("abcde")).toBe(false);
  });
});

describe("isValidDaneDepartamentoCode", () => {
  it("accepts a real 2-digit departamento code", () => {
    expect(isValidDaneDepartamentoCode("05")).toBe(true);
  });

  it("rejects a code outside the catalog", () => {
    expect(isValidDaneDepartamentoCode("00")).toBe(false);
  });
});

describe("resolveDaneMunicipioCode", () => {
  it("resolves a municipio name to its DANE code", () => {
    expect(resolveDaneMunicipioCode("MEDELLÍN")).toBe("05001");
  });

  it("resolves a municipio name scoped to its departamento", () => {
    expect(resolveDaneMunicipioCode("Medellin", "ANTIOQUIA")).toBe("05001");
  });

  it("returns null when the name cannot be matched", () => {
    expect(resolveDaneMunicipioCode("PUEBLO INEXISTENTE")).toBeNull();
  });
});
