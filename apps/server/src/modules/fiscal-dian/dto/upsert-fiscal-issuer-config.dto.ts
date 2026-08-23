import { z } from 'zod';

/**
 * DIAN TaxLevelCode catalogue (technical annex 1.9, numeral 6.1.2) used for
 * the issuer's PartyTaxScheme/cbc:TaxLevelCode. The UBL builder emits this
 * value verbatim.
 */
export const TaxLevelCode = z.enum([
  'R-99-PN', // Régimen común — persona natural
  'R-99-PJ', // Régimen común — persona jurídica
  'R-99-PN-ENT', // Entidad sin ánimo de lucro
  'R-99-PN-SIM', // Régimen simplificado — persona natural
  'O-99', // Otros
]);

export type TaxLevelCodeValue = z.infer<typeof TaxLevelCode>;

// DIAN module-11 check-digit weights for NITs of up to 15 digits, in the
// official order from the technical annex (Res. 000012 de 2008): the
// rightmost digit is multiplied by 3, the next by 7, and so on.
const MOD_11_WEIGHTS = [
  3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71,
];

/**
 * Computes the DIAN verification digit (dígito de verificación) for a NIT
 * using the module-11 algorithm. Non-digit characters in the NIT are ignored
 * so formatted values (dots/dashes) validate identically.
 */
export function computeNitVerificationDigit(nit: string): string | null {
  const digits = nit.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > MOD_11_WEIGHTS.length) {
    return null;
  }

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    sum += digit * MOD_11_WEIGHTS[i];
  }

  const remainder = sum % 11;
  const dv = 11 - remainder;
  if (dv === 11) return '0';
  if (dv === 10) return '1';
  return String(dv);
}

/**
 * Upsert schema for FiscalIssuerConfig.
 * All required fields match the Prisma model; optional fields are nullable.
 * sourceWorkstationId is excluded — it comes from the authenticated session.
 *
 * New DIAN fields (ciiu, municipioCode, softwareId) are nullable/optional on
 * purpose: they are additive so existing clients that predate them keep
 * working; the POS captures them during onboarding.
 */
export const UpsertFiscalIssuerConfigSchema = z
  .object({
    nit: z.string().min(1, 'NIT is required'),
    verificationDigit: z
      .string()
      .regex(/^\d$/, 'Verification digit must be a single digit'),
    businessName: z.string().min(1, 'Business name is required'),
    commercialName: z.string().nullable().optional(),
    organizationType: z.string().min(1, 'Organization type is required'),
    taxRegime: TaxLevelCode,
    taxResponsibilities: z.string().nullable().optional(),
    address: z.string().min(1, 'Address is required'),
    municipality: z.string().min(1, 'Municipality is required'),
    // Código DANE del municipio: 2 dígitos de departamento + 3 de municipio.
    municipioCode: z
      .string()
      .regex(/^\d{5}$/, 'Municipality code must be 5 digits (DANE)')
      .nullable()
      .optional(),
    department: z.string().min(1, 'Department is required'),
    postalCode: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email('Invalid email').nullable().optional(),
    logoUrl: z.string().url('Invalid logo URL').nullable().optional(),
    // Código CIIU de 4 dígitos (actividad económica principal, del RUT).
    ciiu: z
      .string()
      .regex(/^\d{4}$/, 'CIIU must be 4 digits')
      .nullable()
      .optional(),
    // Software habilitado en DIAN por el NIT del contribuyente (sts:softwareID).
    softwareId: z
      .string()
      .min(1, 'Software ID is required when provided')
      .max(64, 'Software ID must not exceed 64 characters')
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    const expected = computeNitVerificationDigit(data.nit);
    if (expected === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nit'],
        message: 'NIT must contain between 1 and 15 digits',
      });
      return;
    }
    if (expected !== data.verificationDigit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verificationDigit'],
        message: `Verification digit does not match the NIT (expected ${expected})`,
      });
    }
  });

export type UpsertFiscalIssuerConfigInput = z.infer<
  typeof UpsertFiscalIssuerConfigSchema
>;

export class UpsertFiscalIssuerConfigDto implements z.infer<
  typeof UpsertFiscalIssuerConfigSchema
> {
  nit!: string;
  verificationDigit!: string;
  businessName!: string;
  commercialName!: string | null;
  organizationType!: string;
  taxRegime!: TaxLevelCodeValue;
  taxResponsibilities!: string | null;
  address!: string;
  municipality!: string;
  municipioCode!: string | null;
  department!: string;
  postalCode!: string | null;
  phone!: string | null;
  email!: string | null;
  logoUrl!: string | null;
  ciiu!: string | null;
  softwareId!: string | null;

  constructor(data?: UpsertFiscalIssuerConfigInput) {
    if (data) {
      this.nit = data.nit;
      this.verificationDigit = data.verificationDigit;
      this.businessName = data.businessName;
      this.commercialName = data.commercialName ?? null;
      this.organizationType = data.organizationType;
      this.taxRegime = data.taxRegime;
      this.taxResponsibilities = data.taxResponsibilities ?? null;
      this.address = data.address;
      this.municipality = data.municipality;
      this.municipioCode = data.municipioCode ?? null;
      this.department = data.department;
      this.postalCode = data.postalCode ?? null;
      this.phone = data.phone ?? null;
      this.email = data.email ?? null;
      this.logoUrl = data.logoUrl ?? null;
      this.ciiu = data.ciiu ?? null;
      this.softwareId = data.softwareId ?? null;
    }
  }
}
