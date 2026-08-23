/**
 * RUT (Registro Único Tributario) text parser.
 *
 * Extracts the DIAN fields needed for electronic invoicing from the text
 * layer of the official RUT PDF (downloaded from MUISCA). The PDF ships
 * with selectable text, so no OCR is required — pdf.js extracts the text
 * and this module turns it into structured fields.
 *
 * Pure text-in/text-out: no DOM, no file IO, no PDF library — unit-testable
 * against captured RUT text fixtures.
 */

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
  /** Raw regimen text, e.g. "RÉGIMEN COMÚN". */
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

const NIT_DV_PATTERN = /(\d[\d.,\s]*)\s*-\s*(\d)\b/;

/**
 * Locate the NIT + verification digit.
 *
 * The RUT shows them combined ("900.123.456-7") on the identity line in
 * most versions, but some layouts separate them into their own labeled
 * fields, so both strategies are attempted.
 */
function extractNitAndDv(lines: string[]): {
  nit: string | null;
  dv: string | null;
} {
  // Strategy 1: any NIT-DV combination anywhere in the document.
  for (const line of lines) {
    const match = line.match(NIT_DV_PATTERN);
    if (match) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) {
        return { nit: digits, dv: match[2] };
      }
    }
  }

  // Strategy 2: separate labeled fields.
  const nit = matchField(lines, [
    /(?:^|\b)NIT\s*[:\s]+(\d[\d.,\s]*)$/,
    /(?:^|\b)NIT\s*[:\s]+(\d[\d.,\s]*)/,
  ]);
  const dv = matchField(lines, [
    /D[IÍ]GITO\s+VERIFICACI[OÓ]N\s*[:\s]+(\d)\b/,
    /\bDV\s*[:\s]+(\d)\b/,
  ]);
  const nitDigits = nit?.replace(/\D/g, '') ?? null;
  return {
    nit: nitDigits && nitDigits.length >= 8 ? nitDigits : null,
    dv,
  };
}

/**
 * Parse the text layer of a RUT PDF into structured fields.
 *
 * Layout-tolerant: each field is matched against a list of label variants
 * seen across DIAN RUT versions. Missing fields stay null — callers decide
 * whether the result is complete enough to autofill.
 */
export function parseRutPdfText(rawText: string): RutParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 0);

  const { nit, dv } = extractNitAndDv(lines);

  const fields: RutExtractedFields = {
    nit,
    dv,
    name: matchField(lines, [
      /(?:^|\b)RAZ[OÓ]N\s+SOCIAL\s*[:\s]+(.+)$/,
      /(?:^|\b)NOMBRE\s+O\s+RAZ[OÓ]N\s+SOCIAL\s*[:\s]+(.+)$/,
      /(?:^|\b)APELLIDOS\s+Y\s+NOMBRES\s*[:\s]+(.+)$/,
    ]),
    organizationType: matchField(lines, [
      /TIPO\s+DE\s+PERSONA\s*[:\s]+(PERSONA\s+(?:JUR[IÍ]DICA|NATURAL))/,
    ]),
    regimen: matchField(lines, [
      // Newer RUT layouts group the regimen under a "RESPONSABILIDAD"
      // label on the same line: "RESPONSABILIDAD : RÉGIMEN COMÚN".
      /RESPONSABILIDAD\s*[:\s]+(R[EÉ]GIMEN\s+(?:COM[UÚ]N|SIMPLIFICADO))/,
      /(?:^|\b)R[EÉ]GIMEN\s+(?:TRIBUTARIO\s+)?(?:DE\s+)?(?:RESPONSABILIDAD\s+)?[:\s]+(R[EÉ]GIMEN\s+(?:COM[UÚ]N|SIMPLIFICADO)|RESPONSABLE\s+DE\s+IVA)/,
      /(?:^|\b)R[EÉ]GIMEN\s*[:\s]+(.+)$/,
    ]),
    ciiu: matchField(lines, [
      /ACTIVIDAD\s+ECON[OÓ]MICA\s+PRINCIPAL\s*[:\s]*(\d{4})/,
      /\bCIIU\s*[:\s]*(\d{4})\b/,
    ]),
    municipio: matchField(lines, [
      /(?:^|\b)MUNICIPIO\s*[:\s]+(.+)$/,
    ]),
    municipioCode: matchField(lines, [
      /MUNICIPIO\s+\(?C[OÓ]DIGO\s+DANE\)?\s*[:\s]*(\d{5})/,
      /\bDANE\s*[:\s]*(\d{5})\b/,
    ]),
    departamento: matchField(lines, [
      /(?:^|\b)DEPARTAMENTO\s*[:\s]+(.+)$/,
    ]),
    address: matchField(lines, [
      /(?:^|\b)DIRECCI[OÓ]N\s*[:\s]+(.+)$/,
      /(?:^|\b)DOMICILIO\s*[:\s]+(.+)$/,
    ]),
    phone: matchField(lines, [
      /TEL[EÉ]FONO\s*[:\s]+([\d\s-]{7,})/,
    ]),
    email: matchField(lines, [
      /CORREO\s+ELECTR[OÓ]NICO\s*[:\s]+(\S+@\S+)/,
      /\bE-?MAIL\s*[:\s]+(\S+@\S+)/,
    ]),
  };

  const extracted = (Object.keys(fields) as RutExtractedFieldKey[]).filter(
    (key) => fields[key] !== null && fields[key] !== '',
  );

  return { fields, extracted };
}