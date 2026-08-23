import {
  UpsertFiscalIssuerConfigSchema,
  computeNitVerificationDigit,
  TaxLevelCode,
} from './upsert-fiscal-issuer-config.dto';

// Official DIAN module-11 weights (technical annex / Resolución 000012 de
// 2008): the rightmost digit is multiplied by 3, the next by 7, and so on.
// This is the published algorithm, written here independently of the
// implementation under test.
const OFFICIAL_MOD_11_WEIGHTS = [
  3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71,
];

function officialMod11VerificationDigit(nit: string): string | null {
  const digits = nit.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > OFFICIAL_MOD_11_WEIGHTS.length) {
    return null;
  }

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    sum += digit * OFFICIAL_MOD_11_WEIGHTS[i];
  }

  const remainder = sum % 11;
  const dv = 11 - remainder;
  if (dv === 11) return '0';
  if (dv === 10) return '1';
  return String(dv);
}

// Reference pairs published by DIAN documentation and independent
// calculators; 800197268-4 is the DIAN's own NIT (same pair the fiscal
// engine hardcodes as DIAN_NIT / DIAN_VERIFICATION_DIGIT).
const DIAN_REFERENCE_VECTORS: [string, string][] = [
  ['800197268', '4'],
  ['900123456', '8'],
  ['890903938', '8'],
  ['800191045', '1'],
  ['77032458', '7'],
];

function buildValidInput(overrides: Record<string, unknown> = {}) {
  return {
    nit: '900123456',
    verificationDigit: '8',
    businessName: 'Mi Droguería SAS',
    commercialName: null,
    organizationType: '1',
    taxRegime: 'R-99-PJ',
    taxResponsibilities: null,
    address: 'Calle 123 #45-67',
    municipality: 'Bogotá D.C.',
    municipioCode: '11001',
    department: 'Cundinamarca',
    postalCode: null,
    phone: null,
    email: 'facturacion@farmacia.co',
    logoUrl: null,
    ciiu: '2100',
    softwareId: 'b8ac9b7c-3f2e-4a6d-9c1e-5f7a8b9c0d1e',
    ...overrides,
  };
}

describe('computeNitVerificationDigit', () => {
  it.each(DIAN_REFERENCE_VECTORS)(
    'returns %s as the verification digit for NIT %s (DIAN reference vector)',
    (nit, expectedDv) => {
      expect(computeNitVerificationDigit(nit)).toBe(expectedDv);
    },
  );

  it.each([
    '900123456',
    '800197268',
    '890903938',
    '800191045',
    '830111391',
    '77032458',
    '123456789',
    '1020304050',
    '555444333',
    '999999999',
    '111111111',
    '123456789012345',
  ])('matches an independent module-11 implementation for NIT %s', (nit) => {
    expect(computeNitVerificationDigit(nit)).toBe(
      officialMod11VerificationDigit(nit),
    );
  });

  it.each(['800.197.268', '800-197-268', '800 197 268', '8.0-0 1 9 7 2 6 8'])(
    'ignores formatting characters in %s',
    (formattedNit) => {
      expect(computeNitVerificationDigit(formattedNit)).toBe('4');
    },
  );

  it.each(['', 'abc', '...'])('returns null when %s has no digits', (input) => {
    expect(computeNitVerificationDigit(input)).toBeNull();
  });

  it('returns null for a NIT with more than 15 digits', () => {
    expect(computeNitVerificationDigit('1234567890123456')).toBeNull();
  });

  it('supports NITs of up to 15 digits', () => {
    expect(computeNitVerificationDigit('123456789012345')).toBe(
      officialMod11VerificationDigit('123456789012345'),
    );
  });
});

describe('UpsertFiscalIssuerConfigSchema', () => {
  it.each(TaxLevelCode.options)('accepts taxRegime %s', (taxRegime) => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ taxRegime }),
    );

    expect(result.success).toBe(true);
  });

  it('accepts a complete payload with the new DIAN fields', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(buildValidInput());

    expect(result.success).toBe(true);
  });

  it('accepts a payload without the new optional DIAN fields', () => {
    const input = buildValidInput();
    delete input.ciiu;
    delete input.municipioCode;
    delete input.softwareId;

    const result = UpsertFiscalIssuerConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  it('accepts null for the optional DIAN fields', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ ciiu: null, municipioCode: null, softwareId: null }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects a free-string taxRegime', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ taxRegime: 'COMUN' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['taxRegime']);
  });

  it('rejects an unknown TaxLevelCode value', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ taxRegime: 'R-99' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['taxRegime']);
  });

  it('rejects a ciiu shorter than 4 digits', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ ciiu: '210' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['ciiu']);
  });

  it('rejects a ciiu longer than 4 digits', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ ciiu: '21001' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['ciiu']);
  });

  it('rejects a municipioCode that is not 5 digits', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ municipioCode: '1101' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['municipioCode']);
  });

  it('rejects a non-digit verificationDigit', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ verificationDigit: 'x' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['verificationDigit']);
  });

  it('rejects a multi-character verificationDigit', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ verificationDigit: '12' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['verificationDigit']);
  });

  it('rejects a verificationDigit that does not match the NIT', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ verificationDigit: '7' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['verificationDigit']);
  });

  it('ignores formatting characters in the NIT when validating the verificationDigit', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ nit: '900.123.456' }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects a NIT with more than 15 digits', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ nit: '1234567890123456' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['nit']);
  });

  it('rejects a NIT with no digits', () => {
    const result = UpsertFiscalIssuerConfigSchema.safeParse(
      buildValidInput({ nit: 'abc' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['nit']);
  });

  it('rejects a payload missing a required field', () => {
    const input = buildValidInput();
    delete input.businessName;

    const result = UpsertFiscalIssuerConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['businessName']);
  });
});