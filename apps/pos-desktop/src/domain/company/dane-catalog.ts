/**
 * DANE territorial catalog — departamentos + municipios with their official
 * DANE codes (DIVIPOLA). Public open data (datos.gov.co / DIVIPOLA),
 * bundled locally so municipality-code resolution works offline.
 */

import daneCatalog from './dane/dane-catalog.json';

export interface DaneMunicipio {
  cod: string;
  nombre: string;
}

export interface DaneDepartamento {
  cod: string;
  nombre: string;
  municipios: DaneMunicipio[];
}

export const DANE_DEPARTAMENTOS: DaneDepartamento[] = daneCatalog;

/** Normalize for accent/case-insensitive lookup: "MEDELLÍN" → "MEDELLIN". */
export function normalizeDaneName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find a departamento by its 2-digit DANE code. */
export function findDaneDepartamento(cod: string): DaneDepartamento | undefined {
  return DANE_DEPARTAMENTOS.find((d) => d.cod === cod);
}

/** Find a municipio anywhere in the catalog by its 5-digit DANE code. */
export function findDaneMunicipio(cod: string): {
  departamento: DaneDepartamento;
  municipio: DaneMunicipio;
} | undefined {
  for (const departamento of DANE_DEPARTAMENTOS) {
    const municipio = departamento.municipios.find((m) => m.cod === cod);
    if (municipio) return { departamento, municipio };
  }
  return undefined;
}

/**
 * Find a municipio by name, optionally scoped to one departamento.
 * Accent/case-insensitive; matches the normalized form.
 */
export function findDaneMunicipioByName(
  nombre: string,
  departamentoNombre?: string,
): DaneMunicipio | undefined {
  const target = normalizeDaneName(nombre);
  for (const departamento of DANE_DEPARTAMENTOS) {
    if (
      departamentoNombre &&
      normalizeDaneName(departamentoNombre) !==
        normalizeDaneName(departamento.nombre) &&
      // Accept the departamento name with/without "D.C." suffix (Bogotá).
      !normalizeDaneName(departamento.nombre).includes(
        normalizeDaneName(departamentoNombre),
      )
    ) {
      continue;
    }
    const municipio = departamento.municipios.find(
      (m) => normalizeDaneName(m.nombre) === target,
    );
    if (municipio) return municipio;
  }
  return undefined;
}

/** True when the code exists in the catalog (5 digits, valid). */
export function isValidDaneMunicipioCode(cod: string): boolean {
  return findDaneMunicipio(cod) !== undefined;
}

/** True when the code exists in the catalog (2 digits, valid). */
export function isValidDaneDepartamentoCode(cod: string): boolean {
  return findDaneDepartamento(cod) !== undefined;
}

/**
 * Resolve the DANE code for a municipio name, or null when it cannot be
 * matched against the catalog.
 */
export function resolveDaneMunicipioCode(
  municipioNombre: string,
  departamentoNombre?: string,
): string | null {
  return (
    findDaneMunicipioByName(municipioNombre, departamentoNombre)?.cod ?? null
  );
}