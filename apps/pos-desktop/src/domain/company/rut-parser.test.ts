/**
 * Unit tests for the RUT PDF text parser against the current DIAN form
 * layout: a numbered-box form where multi-digit values are written one
 * digit per box and reach the parser as spaced runs on reconstructed
 * visual lines. The legacy "LABEL: value" exports stay covered too.
 */
import { describe, expect, it } from 'vitest';
import { parseRutPdfText, type RutExtractedFields } from './rut-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Current DIAN numbered-box form, anonymized legal entity. Values live on
// their own visual rows; digits are separated because each sat in a box.
const NUMBERED_BOX_FORM = [
  'Inscripción 0 1 2. Concepto',
  '4. Número de formulario 141270915303',
  '5. Número de Identificación Tributaria (NIT) 6. DV 12. Dirección seccional 14. Buzón electrónico',
  'Impuestos y Aduanas de Tuluá 2 1',
  '9 0 0 1 2 3 4 5 6 8',
  'IDENTIFICACIÓN',
  '24. Tipo de contribuyente 25. Tipo de documento 26. Número de Identificación',
  '2 1 3 9 0 0 1 2 3 4 5 6 Persona Jurídica',
  '28. País Lugar de expedición 29. Departamento 30. Ciudad/Municipio',
  '1 6 9 5 5001 COLOMBIA Antioquia Medellín',
  '31. Primer apellido 32. Segundo apellido 33. Primer nombre 34. Otros nombres',
  '35. Razón social DROGUERIA LA SALUD SAS',
  '36. Nombre comercial 37. Sigla',
  'UBICACIÓN',
  '38. País 40. Ciudad/Municipio 39. Departamento',
  '1 6 9 5 5001 COLOMBIA Antioquia Medellín',
  '41. Dirección principal',
  'CL 45 B # 12 - 34',
  'test@droguerialasalud.com 42. Correo electrónico',
  // The phone's ten box digits share the row with the label numbering; the
  // spaced run swallows the label's "2" and the parser anchors on the 3.
  '43. Código postal 44. Teléfono 1 45. Teléfono 2 3 1 2 4 5 6 7 8 9 0',
  'CLASIFICACIÓN',
  'Ocupación Actividad económica',
  'Actividad principal Actividad secundaria Otras actividades 52. Número',
  'establecimientos 51. Código 46. Código 47. Fecha inicio actividad 48. Código 49. Fecha inicio actividad 1 2',
  '50. Código',
  '5 8 2 0 2 0 2 6 0 8 1 7',
  'Responsabilidades, Calidades y Atributos',
  '53. Código 4 9',
  '37 - Responsable de IVA',
  'Firma autorizada:',
  'DROGUERIA LA SALUD SAS 984. Nombre',
  'Fecha generación documento PDF: 25-08-2026 09:51:03AM',
].join('\n');

// Same form for a natural person: the name sits under the casillas 31-34
// labels, the razón-social row stays empty and the regimen differs.
const NUMBERED_BOX_NATURAL_PERSON_FORM = [
  'Inscripción 0 1 2. Concepto',
  '4. Número de formulario 141270915304',
  '5. Número de Identificación Tributaria (NIT) 6. DV 12. Dirección seccional 14. Buzón electrónico',
  'Impuestos y Aduanas de Tuluá 2 1',
  '9 0 0 1 2 3 4 5 6 8',
  'IDENTIFICACIÓN',
  '24. Tipo de contribuyente 25. Tipo de documento 26. Número de Identificación',
  '2 1 3 9 0 0 1 2 3 4 5 6 Persona Natural',
  '28. País Lugar de expedición 29. Departamento 30. Ciudad/Municipio',
  '1 6 9 5 5001 COLOMBIA Antioquia Medellín',
  '31. Primer apellido 32. Segundo apellido 33. Primer nombre 34. Otros nombres',
  'CARDONA BLANDON JUAN ESTEBAN',
  '35. Razón social',
  '36. Nombre comercial 37. Sigla',
  'UBICACIÓN',
  '38. País 40. Ciudad/Municipio 39. Departamento',
  '1 6 9 5 5001 COLOMBIA Antioquia Medellín',
  '41. Dirección principal',
  'CL 45 B # 12 - 34',
  'test@droguerialasalud.com 42. Correo electrónico',
  '43. Código postal 44. Teléfono 1 45. Teléfono 2 3 1 2 4 5 6 7 8 9 0',
  'CLASIFICACIÓN',
  'Ocupación Actividad económica',
  'Actividad principal Actividad secundaria Otras actividades 52. Número',
  'establecimientos 51. Código 46. Código 47. Fecha inicio actividad 48. Código 49. Fecha inicio actividad 1 2',
  '50. Código',
  '5 8 2 0 2 0 2 6 0 8 1 7',
  'Responsabilidades, Calidades y Atributos',
  '53. Código 4 9',
  '49 - No responsable de IVA',
  'Firma autorizada:',
  'CARDONA BLANDON JUAN ESTEBAN 984. Nombre',
  'Fecha generación documento PDF: 25-08-2026 09:51:03AM',
].join('\n');

// Older MUISCA-style export: combined "NIT xxx.xxx.xxx-x" plus labeled rows.
const CLASSIC_LABELED_LAYOUT = [
  'REPÚBLICA DE COLOMBIA',
  'NIT: 900.123.456-8',
  'RAZÓN SOCIAL: FARMACIA LOS ANDES S.A.S.',
  'TIPO DE PERSONA: PERSONA JURÍDICA',
  'RESPONSABILIDAD: RÉGIMEN COMÚN',
  'CORREO ELECTRÓNICO: Contacto@FarmaciaAndes.COM',
].join('\n');

// Seccional office name (Tuluá) on its own row while the real location rows
// name Cartago, Valle del Cauca — the municipality must win.
const CARTAGO_SECCIONAL_FORM = [
  '5. Número de Identificación Tributaria (NIT) 6. DV',
  'Impuestos y Aduanas de Tuluá 2 1',
  '9 0 0 1 2 3 4 5 6 8',
  'UBICACIÓN',
  '38. País 40. Ciudad/Municipio 39. Departamento',
  '7 6 0 0 1 COLOMBIA Valle del Cauca Cartago',
].join('\n');

const EMPTY_FIELDS: RutExtractedFields = {
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
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseRutPdfText', () => {
  describe('numbered-box form (current DIAN layout)', () => {
    it('extracts every fiscal field from the legal-entity form', () => {
      const result = parseRutPdfText(NUMBERED_BOX_FORM);

      expect(result.fields).toEqual({
        nit: '900123456',
        dv: '8',
        name: 'DROGUERIA LA SALUD SAS',
        organizationType: 'PERSONA JURÍDICA',
        regimen: 'RESPONSABLE DE IVA',
        ciiu: null,
        municipio: 'MEDELLÍN',
        municipioCode: null,
        departamento: 'ANTIOQUIA',
        address: 'CL 45 B # 12 - 34',
        phone: '3124567890',
        email: 'test@droguerialasalud.com',
      } satisfies RutExtractedFields);
    });

    it('lists only the located fields in the extracted list', () => {
      const result = parseRutPdfText(NUMBERED_BOX_FORM);

      expect(result.extracted).toEqual([
        'nit',
        'dv',
        'name',
        'organizationType',
        'regimen',
        'municipio',
        'departamento',
        'address',
        'phone',
        'email',
      ]);
    });

    it('takes a natural-person name from the surname/given-name box row', () => {
      const result = parseRutPdfText(NUMBERED_BOX_NATURAL_PERSON_FORM);

      expect(result.fields.nit).toBe('900123456');
      expect(result.fields.dv).toBe('8');
      expect(result.fields.name).toBe('CARDONA BLANDON JUAN ESTEBAN');
      expect(result.fields.organizationType).toBe('PERSONA NATURAL');
    });

    it('reads the regimen code row for a non-VAT-responsible person', () => {
      const result = parseRutPdfText(NUMBERED_BOX_NATURAL_PERSON_FORM);

      expect(result.fields.regimen).toBe('NO RESPONSABLE DE IVA');
    });

    it('leaves the CIIU unset when no certain 4-digit activity run exists', () => {
      const result = parseRutPdfText(NUMBERED_BOX_FORM);

      expect(result.fields.ciiu).toBeNull();
    });
  });

  describe('classic labeled layout', () => {
    it('parses the dashed NIT-DV line and the labeled fields', () => {
      const result = parseRutPdfText(CLASSIC_LABELED_LAYOUT);

      expect(result.fields.nit).toBe('900123456');
      expect(result.fields.dv).toBe('8');
      expect(result.fields.name).toBe('FARMACIA LOS ANDES S.A.S.');
      expect(result.fields.organizationType).toBe('PERSONA JURÍDICA');
      expect(result.fields.regimen).toBe('RÉGIMEN COMÚN');
      expect(result.fields.email).toBe('contacto@farmaciaandes.com');
    });
  });

  describe('documents without a verifiable NIT', () => {
    it('returns all-null fields when the DV does not verify', () => {
      // Same form with a misread DV box: modulo 11 rejects every candidate,
      // so the whole document must be discarded instead of half-autofilled.
      const wrongDvForm = NUMBERED_BOX_FORM.replace(
        '9 0 0 1 2 3 4 5 6 8',
        '9 0 0 1 2 3 4 5 6 3',
      );
      const result = parseRutPdfText(wrongDvForm);

      expect(result.fields).toEqual(EMPTY_FIELDS);
      expect(result.extracted).toEqual([]);
    });

    it('returns all-null fields for text without any NIT-like sequence', () => {
      const result = parseRutPdfText(
        'no reconozco este documento\n%#$&*\nhola mundo',
      );

      expect(result.fields).toEqual(EMPTY_FIELDS);
      expect(result.extracted).toEqual([]);
    });

    it('returns all-null fields for empty text', () => {
      const result = parseRutPdfText('');

      expect(result.fields).toEqual(EMPTY_FIELDS);
      expect(result.extracted).toEqual([]);
    });
  });

  describe('location matching', () => {
    it('prefers the municipality beside the department over seccional office names', () => {
      const result = parseRutPdfText(CARTAGO_SECCIONAL_FORM);

      expect(result.fields.nit).toBe('900123456');
      expect(result.fields.departamento).toBe('VALLE DEL CAUCA');
      expect(result.fields.municipio).toBe('CARTAGO');
    });
  });

  describe('field heuristics', () => {
    it('ignores phone-like digit runs on rows without a phone/postal label', () => {
      const strayRunForm = [
        '9 0 0 1 2 3 4 5 6 8',
        '47. Fecha inicio actividad 3 1 2 4 5 6 7 8 9 0',
      ].join('\n');
      const result = parseRutPdfText(strayRunForm);

      expect(result.fields.nit).toBe('900123456');
      expect(result.fields.phone).toBeNull();
    });

    it('lowercases the extracted email address', () => {
      const mixedCaseForm = [
        '9 0 0 1 2 3 4 5 6 8',
        'Correo.Test@DrogueriaLaSalud.COM 42. Correo electrónico',
      ].join('\n');
      const result = parseRutPdfText(mixedCaseForm);

      expect(result.fields.email).toBe('correo.test@droguerialasalud.com');
    });
  });
});
