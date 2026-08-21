import { z } from 'zod';

/**
 * DIAN's own terminology for its web-service environments.
 * Used only at the DTO layer; the Prisma column is a plain String.
 */
export const FiscalEnvironment = {
  HABILITACION: 'HABILITACION',
  PRODUCCION: 'PRODUCCION',
} as const;

export type FiscalEnvironment =
  (typeof FiscalEnvironment)[keyof typeof FiscalEnvironment];

const secretReferencePattern = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_./-]+$/;

/**
 * Upsert schema for TechProviderConfig.
 * `providerType` selects the transmission party (DIAN_DIRECT, ALANUBE,
 * DATAICO); `credentialReference` and `webhookSecretReference` are pointers
 * into a secret store (`store:path` convention), never the credential
 * material itself.
 */
export const UpsertTechProviderConfigSchema = z.object({
  providerType: z
    .enum(['DIAN_DIRECT', 'ALANUBE', 'DATAICO'])
    .default('DIAN_DIRECT'),
  endpointUrl: z.string().url('Endpoint URL must be a valid URL'),
  environment: z.enum(['HABILITACION', 'PRODUCCION']),
  timeoutSeconds: z.number().int().positive().default(30),
  credentialReference: z
    .string()
    .regex(secretReferencePattern, 'Must follow store:path convention')
    .nullable()
    .optional(),
  webhookSecretReference: z
    .string()
    .regex(secretReferencePattern, 'Must follow store:path convention')
    .nullable()
    .optional(),
});

export type UpsertTechProviderConfigInput = z.infer<
  typeof UpsertTechProviderConfigSchema
>;

export class UpsertTechProviderConfigDto implements z.infer<
  typeof UpsertTechProviderConfigSchema
> {
  providerType!: 'DIAN_DIRECT' | 'ALANUBE' | 'DATAICO';
  endpointUrl!: string;
  environment!: FiscalEnvironment;
  timeoutSeconds!: number;
  credentialReference!: string | null;
  webhookSecretReference!: string | null;

  constructor(data?: UpsertTechProviderConfigInput) {
    if (data) {
      this.providerType = data.providerType;
      this.endpointUrl = data.endpointUrl;
      this.environment = data.environment as FiscalEnvironment;
      this.timeoutSeconds = data.timeoutSeconds;
      this.credentialReference = data.credentialReference ?? null;
      this.webhookSecretReference = data.webhookSecretReference ?? null;
    }
  }
}
