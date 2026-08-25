import { z } from 'zod';

/**
 * DIAN's own terminology for its web-service environments.
 * Used only at the DTO layer; the Prisma column stores the wire literal.
 */
export const FiscalEnvironment = {
  HABILITACION: 'HABILITACION',
  PRODUCCION: 'PRODUCCION',
} as const;

export type FiscalEnvironment =
  (typeof FiscalEnvironment)[keyof typeof FiscalEnvironment];

/**
 * Canonical at-rest vocabulary: the DIAN Technical Annex TipoAmbiente
 * literals consumed by the fiscal engine (endpoint selection, CUFE
 * formula, UBL). The engine fails fast on anything else
 * (DIAN_ENVIRONMENT_INVALID), so this layer is the single normalization
 * point: both DIAN's terms and the raw literals are accepted as input,
 * only the literal is persisted.
 */
export const DIAN_ENVIRONMENT_LITERAL = {
  PRODUCCION: '1',
  HABILITACION: '2',
} as const;

export type DianEnvironmentLiteral =
  (typeof DIAN_ENVIRONMENT_LITERAL)[keyof typeof DIAN_ENVIRONMENT_LITERAL];

function toEnvironmentLiteral(
  value: FiscalEnvironment | DianEnvironmentLiteral,
): DianEnvironmentLiteral {
  switch (value) {
    case 'PRODUCCION':
    case '1':
      return DIAN_ENVIRONMENT_LITERAL.PRODUCCION;
    case 'HABILITACION':
    case '2':
      return DIAN_ENVIRONMENT_LITERAL.HABILITACION;
  }
}

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
  environment: z
    .union([z.enum(['HABILITACION', 'PRODUCCION']), z.enum(['1', '2'])])
    .transform(toEnvironmentLiteral),
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

export type UpsertTechProviderConfigInput = z.input<
  typeof UpsertTechProviderConfigSchema
>;

export type UpsertTechProviderConfigOutput = z.output<
  typeof UpsertTechProviderConfigSchema
>;

export class UpsertTechProviderConfigDto implements UpsertTechProviderConfigOutput {
  providerType!: 'DIAN_DIRECT' | 'ALANUBE' | 'DATAICO';
  endpointUrl!: string;
  environment!: DianEnvironmentLiteral;
  timeoutSeconds!: number;
  credentialReference!: string | null;
  webhookSecretReference!: string | null;

  constructor(data?: UpsertTechProviderConfigOutput) {
    if (data) {
      this.providerType = data.providerType;
      this.endpointUrl = data.endpointUrl;
      this.environment = data.environment;
      this.timeoutSeconds = data.timeoutSeconds;
      this.credentialReference = data.credentialReference ?? null;
      this.webhookSecretReference = data.webhookSecretReference ?? null;
    }
  }
}
