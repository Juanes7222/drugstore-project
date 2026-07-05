import { z } from 'zod';

/**
 * Upsert schema for FiscalIssuerConfig.
 * All required fields match the Prisma model; optional fields are nullable.
 * sourceWorkstationId is excluded — it comes from the authenticated session.
 */
export const UpsertFiscalIssuerConfigSchema = z.object({
  nit: z.string().min(1, 'NIT is required'),
  verificationDigit: z.string().min(1, 'Verification digit is required'),
  businessName: z.string().min(1, 'Business name is required'),
  commercialName: z.string().nullable().optional(),
  organizationType: z.string().min(1, 'Organization type is required'),
  taxRegime: z.string().min(1, 'Tax regime is required'),
  taxResponsibilities: z.string().nullable().optional(),
  address: z.string().min(1, 'Address is required'),
  municipality: z.string().min(1, 'Municipality is required'),
  department: z.string().min(1, 'Department is required'),
  postalCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email('Invalid email').nullable().optional(),
  logoUrl: z.string().url('Invalid logo URL').nullable().optional(),
});

export type UpsertFiscalIssuerConfigInput = z.infer<typeof UpsertFiscalIssuerConfigSchema>;

export class UpsertFiscalIssuerConfigDto implements z.infer<typeof UpsertFiscalIssuerConfigSchema> {
  nit!: string;
  verificationDigit!: string;
  businessName!: string;
  commercialName!: string | null;
  organizationType!: string;
  taxRegime!: string;
  taxResponsibilities!: string | null;
  address!: string;
  municipality!: string;
  department!: string;
  postalCode!: string | null;
  phone!: string | null;
  email!: string | null;
  logoUrl!: string | null;

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
      this.department = data.department;
      this.postalCode = data.postalCode ?? null;
      this.phone = data.phone ?? null;
      this.email = data.email ?? null;
      this.logoUrl = data.logoUrl ?? null;
    }
  }
}
