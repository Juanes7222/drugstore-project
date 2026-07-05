import { z } from 'zod';

/**
 * DIAN's own terminology for its web-service environments.
 * Used only at the DTO layer; the Prisma column is a plain String.
 */
export const FiscalEnvironment = {
  HABILITACION: 'HABILITACION',
  PRODUCCION: 'PRODUCCION',
} as const;

export type FiscalEnvironment = (typeof FiscalEnvironment)[keyof typeof FiscalEnvironment];

const credentialReferencePattern = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_./-]+$/;

/**
 * Upsert schema for TechProviderConfig.
 * `environment` is validated against the local FiscalEnvironment enum.
 * `credentialReference` must follow the `provider:path` convention — a pointer
 * into an external secret manager, never the actual credential material.
 */
export const UpsertTechProviderConfigSchema = z.object({
  endpointUrl: z.string().url('Endpoint URL must be a valid URL'),
  environment: z.enum(['HABILITACION', 'PRODUCCION']),
  timeoutSeconds: z.number().int().positive().default(30),
  credentialReference: z
    .string()
    .regex(credentialReferencePattern, 'Must follow provider:path convention')
    .nullable()
    .optional(),
});

export type UpsertTechProviderConfigInput = z.infer<typeof UpsertTechProviderConfigSchema>;

export class UpsertTechProviderConfigDto implements z.infer<typeof UpsertTechProviderConfigSchema> {
  endpointUrl!: string;
  environment!: FiscalEnvironment;
  timeoutSeconds!: number;
  credentialReference!: string | null;

  constructor(data?: UpsertTechProviderConfigInput) {
    if (data) {
      this.endpointUrl = data.endpointUrl;
      this.environment = data.environment as FiscalEnvironment;
      this.timeoutSeconds = data.timeoutSeconds;
      this.credentialReference = data.credentialReference ?? null;
    }
  }
}
