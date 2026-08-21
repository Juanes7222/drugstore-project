import { z } from 'zod';

export const MAX_CERTIFICATE_BASE64_LENGTH = 4 * 1024 * 1024;

/**
 * Upload schema for a DIAN digital certificate.
 *
 * The bundle travels as base64 inside the JSON body (the same shape the
 * fiscal engine's secret files used), so no multipart handling or
 * temporary files are needed. The private-key material is encrypted by
 * FiscalCertificateCryptoService before any persistence.
 */
export const UploadFiscalCertificateSchema = z.object({
  alias: z
    .string()
    .trim()
    .min(1, 'Alias is required')
    .max(100, 'Alias must be at most 100 characters'),
  certificateBase64: z
    .string()
    .min(1, 'Certificate is required')
    .max(
      MAX_CERTIFICATE_BASE64_LENGTH,
      'Certificate is too large (max 4 MB of base64 data)',
    )
    .refine(
      (value) =>
        /^[A-Za-z0-9+/=\s]+$/.test(value) && value.trim().length % 4 === 0,
      'Certificate must be a valid base64-encoded PKCS#12 file',
    ),
  password: z.string().min(1, 'Certificate password is required'),
  softwareSecurityCode: z
    .string()
    .trim()
    .min(10, 'Software security code looks too short')
    .max(100, 'Software security code must be at most 100 characters'),
});

export type UploadFiscalCertificateInput = z.infer<
  typeof UploadFiscalCertificateSchema
>;

export class UploadFiscalCertificateDto implements z.infer<
  typeof UploadFiscalCertificateSchema
> {
  alias!: string;
  certificateBase64!: string;
  password!: string;
  softwareSecurityCode!: string;

  constructor(data?: UploadFiscalCertificateInput) {
    if (data) {
      this.alias = data.alias;
      this.certificateBase64 = data.certificateBase64;
      this.password = data.password;
      this.softwareSecurityCode = data.softwareSecurityCode;
    }
  }
}
