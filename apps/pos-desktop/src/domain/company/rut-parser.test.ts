/**
 * Unit tests for the RUT PDF text parser.
 *
 * Fixtures mirror the text layer of real DIAN RUT documents: one layout with
 * the combined "NIT 900.123.456-7" identity line, one with NIT and DV in
 * separate labeled fields, and label variants seen across RUT versions.
 */
import { describe, expect, it } from 'vitest';
import { parseRutPdfText, type RutExtractedFields } from './rut-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_LAYOUT = [
  'REPÚBLICA DE COLOMBIA',
  'IDENTIFICACIÓN TRIBUTARIA',
  'NIT 900.123.456-7',
  'RAZÓN SOCIAL: FARMACIA LOS ANDES S.A.S.',
  'TIPO DE PERSONA: PERSONA JURÍDICA',
  'RÉGIMEN TRIBUTARIO DE RESPONSABILIDAD : RÉGIMEN COMÚN',
  'ACTIVIDAD ECONÓMICA PRINCIPAL: 4773',
  'MUNICIPIO: MEDELLÍN',
  'MUNICIPIO (CÓDIGO DANE): 05001',
  'DEPARTAMENTO: ANTIOQUIA',
  'DIRECCIÓN: CRA 45 # 12-34',
  'TELÉFONO: 604 444 5678',
  'CORREO ELECTRÓNICO: contacto@farmaciaandesa.com',
].join('\n');

const SEPARATED_LAYOUT = [
  'IDENTIFICACIÓN DEL RESPONSABLE',
  'NIT: 900123456',
  'DÍGITO VERIFICACIÓN: 7',
  'APELLIDOS Y NOMBRES: MARÍA CAMILA RODRÍGUEZ PÉREZ',
  'TIPO DE PERSONA: PERSONA NATURAL',
].join('\n');

const LABEL_VARIANTS = [
  'NOMBRE O RAZÓN SOCIAL: DROGUERÍA LA ESPERANZA',
  'CIIU: 4772',
  'CÓDIGO DANE: 11001',
  'E-MAIL: esperanza@drogueria.com',
].join('\n');

const IVA_RESPONSIBLE_LAYOUT = [
  'RAZÓN SOCIAL: COMERCIALIZADORA DEL CAUCA LTDA',
  'RÉGIMEN TRIBUTARIO DE RESPONSABILIDAD : RESPONSABLE DE IVA',
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
  describe('combined NIT-DV layout', () => {
    it('extracts every fiscal field from a full RUT document', () => {
      const result = parseRutPdfText(FULL_LAYOUT);

      expect(result.fields).toEqual({
        nit: '900123456',
        dv: '7',
        name: 'FARMACIA LOS ANDES S.A.S.',
        organizationType: 'PERSONA JURÍDICA',
        regimen: 'RÉGIMEN COMÚN',
        ciiu: '4773',
        municipio: 'MEDELLÍN',
        municipioCode: '05001',
        departamento: 'ANTIOQUIA',
        address: 'CRA 45 # 12-34',
        phone: '604 444 5678',
        email: 'CONTACTO@FARMACIAANDESA.COM',
      });
    });

    it('reports every located field in the extracted list', () => {
      const result = parseRutPdfText(FULL_LAYOUT);

      expect(result.extracted.sort()).toEqual(
        [
          'nit',
          'dv',
          'name',
          'organizationType',
          'regimen',
          'ciiu',
          'municipio',
          'municipioCode',
          'departamento',
          'address',
          'phone',
          'email',
        ].sort(),
      );
    });
  });

  describe('separated NIT and DV layout', () => {
    it('joins the labeled NIT field with the verification-digit field', () => {
      const result = parseRutPdfText(SEPARATED_LAYOUT);

      expect(result.fields.nit).toBe('900123456');
      expect(result.fields.dv).toBe('7');
      expect(result.fields.name).toBe('MARÍA CAMILA RODRÍGUEZ PÉREZ');
      expect(result.fields.organizationType).toBe('PERSONA NATURAL');
    });
  });

  describe('label variants', () => {
    it('accepts NOMBRE O RAZÓN SOCIAL and E-MAIL labels', () => {
      const result = parseRutPdfText(LABEL_VARIANTS);

      expect(result.fields.name).toBe('DROGUERÍA LA ESPERANZA');
      expect(result.fields.ciiu).toBe('4772');
      expect(result.fields.municipioCode).toBe('11001');
      expect(result.fields.email).toBe('ESPERANZA@DROGUERIA.COM');
    });

    it('accepts the RESPONSABLE DE IVA regimen variant', () => {
      const result = parseRutPdfText(IVA_RESPONSIBLE_LAYOUT);

      expect(result.fields.regimen).toBe('RESPONSABLE DE IVA');
    });
  });

  describe('unreadable documents', () => {
    it('returns null fields and an empty extracted list for empty text', () => {
      const result = parseRutPdfText('');

      expect(result.fields).toEqual(EMPTY_FIELDS);
      expect(result.extracted).toEqual([]);
    });

    it('returns null fields for text without any recognizable labels', () => {
      const result = parseRutPdfText('no reconozco este documento\n%#$&*');

      expect(result.fields).toEqual(EMPTY_FIELDS);
      expect(result.extracted).toEqual([]);
    });
  });
});