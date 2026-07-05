import { z } from 'zod';

/**
 * Temporary local schema for system configuration values with discriminated union by valueType.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 * Covers the four ConfigValueType variants: NUMBER, BOOLEAN, STRING, ARRAY, OBJECT.
 *
 * Note: Enforcing the isSensitive read restriction at the service layer is deferred to the
 * configuration module's logic phase. The scaffolded service method throws
 * NotImplementedForPhaseException regardless of isSensitive for now.
 */
export const SystemConfigValueSchema = z.discriminatedUnion('valueType', [
  z.object({
    valueType: z.literal('NUMBER'),
    value: z.number(),
  }),
  z.object({
    valueType: z.literal('BOOLEAN'),
    value: z.boolean(),
  }),
  z.object({
    valueType: z.literal('STRING'),
    value: z.string(),
  }),
  z.object({
    valueType: z.literal('ARRAY'),
    value: z.array(z.any()),
  }),
  z.object({
    valueType: z.literal('OBJECT'),
    value: z.record(z.string(), z.any()),
  }),
]);

export type SystemConfigValueInput = z.infer<typeof SystemConfigValueSchema>;

export const UpsertSystemConfigSchema = z.object({
  key: z
    .string()
    .min(1, 'Configuration key is required')
    .max(255, 'Configuration key must not exceed 255 characters'),
  module: z.string().min(1, 'Module is required'),
  description: z.string().max(500).optional(),
  isSensitive: z.boolean().default(false),
  configValue: SystemConfigValueSchema,
});

export type UpsertSystemConfigInput = z.infer<typeof UpsertSystemConfigSchema>;
