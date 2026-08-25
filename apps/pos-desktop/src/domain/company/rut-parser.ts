/**
 * RUT (Registro Único Tributario) text parser.
 *
 * Extracts the DIAN fields needed for electronic invoicing from the text
 * layer of the official RUT PDF. The RUT is a FORM: the extractor
 * reassembles visual lines by position before this parser runs.
 *
 * Two layouts are supported:
 * - Classic "LABEL: value" lines (older MUISCA exports).
 * - The numbered-box form ("35. Razón social", digits written one per box,
 *   values on their own visual row), which is what current DIAN PDFs use.
 *
 * Pure text-in/result-out: no DOM, no file IO, no PDF library. Every field
 * is best-effort — missing fields stay null and the wizard lets the user
 * complete them manually. The NIT is only accepted when it validates
 * against its verification digit, so a mis-read can never autofill garbage.
 */

import {
  DANE_DEPARTAMENTOS,
  normalizeDaneName,
} from './dane-catalog';
import { isValidNitDv } from '../../common/nit';

/**
 * The subset of RUT fields that map onto company/issuer data.
 * All optional — a field the parser could not locate stays null.
 */
export interface RutExtractedFields {
  nit: string | null;
  dv: string | null;
  /** Razón social (legal entity) or full name (natural person). */
  name: string | null;
  organizationType: string | null;
  /** Raw regimen/responsibility text, e.g. "RÉGIMEN COMÚN". */
  regimen: string | null;
  /** CIIU economic-activity code (4 digits). */
  ciiu: string | null;
  municipio: string | null;
  /** DANE municipality code (5 digits). */
  municipioCode: string | null;
  departamento: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

/** Names of the fields actually located in the text (for UI feedback). */
export type RutExtractedFieldKey = keyof RutExtractedFields;

export interface RutParseResult {
  fields: RutExtractedFields;
  /** Keys of the fields that were found in the document. */
  extracted: RutExtractedFieldKey[];
}

/** Normalize a line: uppercase, collapse whitespace, trim. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** First capture group of the first matching pattern, or null. */
function matchField(lines: string[], patterns: RegExp[]): string | null {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return null;
}

/** Collapse spaced-out single digits ("1 1 3 8 5") into "11385". */
function collapseSpacedDigits(sequence: string): string {
  return sequence.replace(/[\s.,]/g, '');
}

// ---------------------------------------------------------------------------
// NIT + verification digit
// ---------------------------------------------------------------------------

/** Classic combined form: "900.123.456-7" or "900123456-7". */
const NIT_DV_PATTERN = /(\d[\d.,\s]*)\s*-\s*(\d)\b/;

/**
 * A run of space-separated single digits — how the numbered-box form writes
 * multi-digit values (NIT boxes, phone boxes, dates...). Requires at least
 * 7 digits so short box runs (flags, codes) are ignored.
 */
const SPACED_DIGIT_RUN =
  /(?<![\d])(?:\d[ .,]+){6,}\d(?![\d])/g;

interface NitCandidate {
  nit: string;
  dv: string | null;
  occurrences: number;
}

/**
 * Collect candidate NIT sequences from both layouts and rank them:
 * validated candidates first, then by occurrences, then by length.
 */
function collectNitCandidates(lines: string[]): NitCandidate[] {
  const candidates = new Map<string, NitCandidate>();

  const push = (nitRaw: string, dvRaw: string | null) => {
    const nit = nitRaw.replace(/\D/g, '');
    const dv = dvRaw?.replace(/\D/g, '') ?? null;
    if (nit.length < 8 || nit.length > 15) return;
    const key = `${nit}|${dv ?? ''}`;
    const existing = candidates.get(key);
    if (existing) existing.occurrences += 1;
    else candidates.set(key, { nit, dv, occurrences: 1 });
  };

  for (const line of lines) {
    // Layout 1: explicit NIT-DV combination with a dash.
    const dashed = line.match(NIT_DV_PATTERN);
    if (dashed) push(dashed[1], dashed[2]);

    // Layout 2: runs of spaced single digits (form boxes).
    for (const run of line.match(SPACED_DIGIT_RUN) ?? []) {
      const digits = collapseSpacedDigits(run);
      if (digits.length < 7 || digits.length > 16) continue;

      // Try the last digit as the DV of the remaining ones
      // (the form writes the NIT boxes followed by the DV box).
      if (digits.length >= 9) {
        push(digits.slice(0, -1), digits.slice(-1));
      }

      // Also try the whole run as a bare NIT (DV may sit in another box).
      push(digits, null);

      // And try dropping a leading/trailing stray box digit.
      if (digits.length >= 10) {
        push(digits.slice(0, -2), digits.slice(-2, -1));
        push(digits.slice(1, -1), null);
      }
    }
  }

  return [...candidates.values()].sort((a, b) => {
    const aValid = isValidNitCandidate(a);
    const bValid = isValidNitCandidate(b);
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return b.nit.length - a.nit.length;
  });
}

function isValidNitCandidate(candidate: NitCandidate): boolean {
  return candidate.dv !== null && verifyNitDv(candidate.nit, candidate.dv);
}

/** Modulo-11 DIAN verification digit (kept local to stay dependency-free). */
function verifyNitDv(nit: string, dv: string): boolean {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  const digits = nit.split('').reverse();
  for (let i = 0; i < digits.length; i += 1) {
    sum += Number(digits[i]) * weights[i % weights.length];
  }
  const remainder = sum % 11;
  const expected = remainder === 0 ? '0' : String(11 - remainder === 10 ? 9 : 11 - remainder);
  return expected === dv;
}

/**
 * Locate the NIT + verification digit.
 *
 * Only a candidate whose verification digit checks out is accepted; when
 * none validates, both stay null so the caller reports an unreadable RUT
 * instead of autofilling a wrong identity.
 */
function extractNitAndDv(
  lines: string[],
  isValidNitDv: (nit: string, dv: string) => boolean,
): { nit: string | null; dv: string | null } {
  for (const candidate of collectNitCandidates(lines)) {
    if (candidate.dv && isValidNitDv(candidate.nit, candidate.dv)) {
      return { nit: candidate.nit, dv: candidate.dv };
    }
  }
  return { nit: null, dv: null };
}

// ---------------------------------------------------------------------------
// Free-form field heuristics (numbered-box form)
// ---------------------------------------------------------------------------

/**
 * Words that identify boilerplate rows of the form. Name candidates must
 * not contain any of them.
 */
const NAME_STOPWORDS = new Set(
  [
    'DIAN', 'RUT', 'REGISTRO', 'TRIBUTARIO', 'UNICO', 'ÚNICO', 'COLOMBIA',
    'CONTRIBUYENTE', 'PERSONA', 'NATURAL', 'JURIDICA', 'JURÍDICA', 'SUCESION',
    'SUCESIÓN', 'ILIQIDA', 'ILÍQUIDA', 'IMPORTANTE', 'FIRMA', 'SOLICITANTE',
    'AUTORIZADA', 'PAGINA', 'PÁGINA', 'FECHA', 'IDENTIFICACION',
    'IDENTIFICACIÓN', 'ACTIVIDAD', 'ECONOMICA', 'ECONÓMICA', 'PRINCIPAL',
    'SECUNDARIA', 'RESPONSABILIDADES', 'CALIDADES', 'ATRIBUTOS', 'EXPORTADORES',
    'USUARIOS', 'ADUANEROS', 'UBICACION', 'UBICACIÓN', 'CLASIFICACION',
    'CLASIFICACIÓN', 'EXPEDICION', 'EXPEDICIÓN', 'OCUPACION', 'OCUPACIÓN',
    'RAZON', 'RAZÓN', 'SOCIAL', 'COMERCIAL', 'SIGLA', 'PRIMER', 'SEGUNDO',
    'APELLIDO', 'NOMBRE', 'NOMBRES', 'OTROS', 'NUMERO', 'NÚMERO',
    'FORMULARIO', 'CONCEPTO', 'INSCRIPCION', 'INSCRIPCIÓN', 'CODIGO', 'CÓDIGO',
    'POSTAL', 'TELEFONO', 'TELÉFONO', 'CORREO', 'ELECTRONICO', 'ELECTRÓNICO',
    'DIRECCION', 'DIRECCIÓN', 'CIUDAD', 'PAIS', 'PAÍS', 'LUGAR', 'SECCIONAL',
    'BUZON', 'BUZÓN', 'IMPUESTOS', 'ADUANAS', 'ESTABLECIMIENTOS', 'FOLIOS',
    'ANEXOS', 'MODALIDAD', 'MODO', 'TIPO', 'DOCUMENTO', 'CARGO',
  ].map((word) => normalizeDaneName(word)),
);

/**
 * Extract the holder name: the longest run of consecutive ALL-CAPS tokens
 * that contains no numbers, no stopword and no label numbering. Numbered
 * box markers ("35.", "6.") are stripped first so value rows that carry
 * their label still yield the full name.
 */
function extractHolderName(lines: string[]): string | null {
  let best: string | null = null;

  for (const rawLine of lines) {
    if (/DIAN|RUT|REGISTRO/.test(normalizeDaneName(rawLine))) continue;

    const line = rawLine.replace(/\d+\.\s*/g, ' ');
    const tokens = line.split(' ');
    let run: string[] = [];
    let bestRun: string[] = [];

    for (const token of tokens) {
      const normalized = normalizeDaneName(token);
      const isCapsWord = /^[A-ZÑ]{2,}$/.test(normalized);
      const isStopword = NAME_STOPWORDS.has(normalized);
      if (isCapsWord && !isStopword) {
        run.push(token);
        if (run.length > bestRun.length) bestRun = [...run];
      } else {
        run = [];
      }
    }

    // At least a surname + given name (2 tokens) to be useful.
    if (bestRun.length >= 2) {
      const candidate = bestRun.join(' ');
      if (!best || candidate.length > best.length) best = candidate;
    }
  }

  return best;
}

/** Street-address heuristics: Colombian via formats or a '#' height mark. */
function extractAddress(lines: string[]): string | null {
  for (const line of lines) {
    if (/^\d+\./.test(line)) continue;
    const compact = line.trim();
    if (/#[^#]*\d/.test(compact) || /^(CR|CRA|CALLE|CL|AV|AVENIDA|TRANSVERSAL|TV|DIAGONAL|DG|MANZANA|MZ|VEREDA|KILOMETRO|KM)\b.*\d/i.test(compact)) {
      // Reject obvious non-addresses (dates, long boilerplate).
      if (compact.length <= 60 && !/@/.test(compact)) return compact;
    }
  }
  return null;
}

/** Colombian mobile written across digit boxes (10 digits starting with 3). */
function extractPhone(lines: string[]): string | null {
  for (const line of lines) {
    // Only trust digit-box runs on rows that carry the phone/postal labels,
    // otherwise the form's box-numbering lists would false-positive.
    if (!/TEL[ÉE]FONO|C[OÓ]DIGO\s+POSTAL/.test(line)) continue;

    for (const run of line.match(SPACED_DIGIT_RUN) ?? []) {
      const digits = collapseSpacedDigits(run);
      if (digits.length < 10 || digits.length > 12) continue;

      // The run often swallows a neighboring box's digit before the number
      // ("Teléfono 2 | 3 0 1 ..."), so anchor on the first '3'.
      const anchor = digits.startsWith('3') ? 0 : digits.indexOf('3');
      if (anchor !== -1 && digits.length - anchor >= 10) {
        return digits.slice(anchor, anchor + 10);
      }
    }
  }
  return null;
}

/** First email-like token anywhere in the document (original casing). */
function extractEmail(rawLines: string[]): string | null {
  for (const line of rawLines) {
    const match = line.match(/\b([\w.+-]+@[\w-]+\.[\w.-]{2,})\b/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Match departamento/municipio names against the bundled DANE catalog.
 * The form repeats the location twice (identification + address); matching
 * against the catalog avoids trusting any particular occurrence. When
 * several department names match, the LONGEST wins ("VALLE DEL CAUCA"
 * beats its substring "CAUCA").
 */
function extractLocation(
  lines: string[],
): { municipio: string | null; departamento: string | null; municipioCode: string | null } {
  let departamento: string | null = null;
  let municipio: string | null = null;

  for (const line of lines) {
    const normalizedLine = normalizeDaneName(line);
    for (const depto of DANE_DEPARTAMENTOS) {
      const deptoName = normalizeDaneName(depto.nombre);
      if (
        normalizedLine.includes(deptoName) &&
        (!departamento || deptoName.length > normalizeDaneName(departamento).length)
      ) {
        departamento = depto.nombre;
      }
    }
  }

  if (departamento) {
    const depto = DANE_DEPARTAMENTOS.find((d) => d.nombre === departamento);
    const deptoName = normalizeDaneName(departamento);

    // Prefer location rows (they carry the department and/or the country
    // next to the municipality) so DIAN office names like "Impuestos y
    // Aduanas de Tuluá" don't shadow the real municipality.
    const locationRows = lines.filter(
      (line) =>
        normalizeDaneName(line).includes(deptoName) ||
        /\bCOLOMBIA\b/.test(line),
    );
    const searchOrder =
      locationRows.length > 0 ? [...locationRows, ...lines] : lines;

    outer: for (const line of searchOrder) {
      const normalizedLine = normalizeDaneName(line);
      for (const municipioEntry of depto?.municipios ?? []) {
        const munName = normalizeDaneName(municipioEntry.nombre);
        if (munName.length < 4) continue;
        if (normalizedLine.includes(munName)) {
          municipio = municipioEntry.nombre;
          break outer;
        }
      }
    }
  }

  return {
    municipio,
    departamento,
    municipioCode: null,
  };
}

/** Responsibility/regimen marker anywhere in the text. */
function extractRegimen(flatText: string): string | null {
  const match = flatText.match(
    /(NO\s+RESPONSABLE\s+DE\s+IVA|RESPONSABLE\s+DE\s+IVA|GRAN\s+CONTRIBUTOR(?:[EI])?|R[EÉ]GIMEN\s+(?:SIMPLE|COM[UÚ]N|SIMPLIFICADO)|NO\s+RESPONSABLE)/i,
  );
  return match?.[1]?.toUpperCase().replace(/\s+/g, ' ') ?? null;
}

/** Person/legal-entity type anywhere in the text. */
function extractOrganizationType(flatText: string): string | null {
  const match = flatText.match(/(PERSONA\s+JUR[IÍ]DICA|PERSONA\s+NATURAL)/i);
  return match?.[1]?.toUpperCase().replace(/\s+/g, ' ') ?? null;
}

/**
 * CIIU principal code: a spaced 4-digit run near an activity/code label.
 * Deliberately conservative — a wrong CIIU is worse than none, and the
 * wizard lets the user type it.
 */
function extractCiiu(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/ACTIVIDAD\s+ECON[OÓ]MICA\s+(?:PRINCIPAL)?|CIIU/.test(line)) continue;

    // The value may sit on the same row or the row below (form layout).
    const nearby = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ');

    for (const run of nearby.match(SPACED_DIGIT_RUN) ?? []) {
      const digits = collapseSpacedDigits(run);
      if (digits.length === 4) return digits;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the text layer of a RUT PDF into structured fields, using the
 * standard DIAN modulo-11 verifier for the NIT.
 */
export function parseRutPdfText(rawText: string): RutParseResult {
  return parseRutPdfTextWith(rawText, isValidNitDv);
}

/**
 * Parse the text layer of a RUT PDF into structured fields.
 *
 * `isValidNitDv` is injected so tests can swap the verifier or trace the
 * candidate ranking.
 */
export function parseRutPdfTextWith(
  rawText: string,
  isValidNitDv: (nit: string, dv: string) => boolean,
): RutParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 0);
  // Emails are matched on the original casing — the uppercase normalization
  // used for label matching would mangle them.
  const rawLines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const flatUppercased = lines.join('\n');

  const { nit, dv } = extractNitAndDv(lines, isValidNitDv);

  // Without a verified identity this is not a usable RUT — return nothing
  // rather than autofilling partially-guessed fields (the caller reports
  // UNPARSEABLE and the user types the data manually).
  if (!nit || !dv) {
    return {
      fields: {
        nit: null,
        dv: null,
        name: null,
        organizationType: null,
        regimen: null,
        ciiu: null,
        municipio: null,
        municipioCode: null,
        departamento: null,
        address: null,
        phone: null,
        email: null,
      },
      extracted: [],
    };
  }

  const fields: RutExtractedFields = {
    nit,
    dv,
    // Classic labeled layouts first, then the form heuristics.
    name:
      matchField(lines, [
        /(?:^|\b)RAZ[OÓ]N\s+SOCIAL\s*[:\s]+(.+)$/,
        /(?:^|\b)NOMBRE\s+O\s+RAZ[OÓ]N\s+SOCIAL\s*[:\s]+(.+)$/,
        /(?:^|\b)APELLIDOS\s+Y\s+NOMBRES\s*[:\s]+(.+)$/,
      ]) ?? extractHolderName(lines),
    organizationType: extractOrganizationType(flatUppercased),
    regimen:
      matchField(lines, [
        /RESPONSABILIDAD\s*[:\s]+(R[EÉ]GIMEN\s+(?:COM[UÚ]N|SIMPLIFICADO))/,
        /(?:^|\b)R[EÉ]GIMEN\s*[:\s]+(.+)$/,
      ]) ?? extractRegimen(flatUppercased),
    ciiu: extractCiiu(lines),
    ...extractLocation(lines),
    address: extractAddress(lines),
    phone: extractPhone(lines),
    email: extractEmail(rawLines),
  };

  const extracted = (Object.keys(fields) as RutExtractedFieldKey[]).filter(
    (key) => fields[key] !== null && fields[key] !== '',
  );

  return { fields, extracted };
}