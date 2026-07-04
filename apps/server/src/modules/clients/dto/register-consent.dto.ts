import { z } from 'zod';

export enum ConsentPurpose {
  MARKETING = 'MARKETING',
  DATA_SHARING = 'DATA_SHARING',
  HISTORY = 'HISTORY',
}

export const RegisterConsentSchema = z.object({
  consentVersion: z.string().min(1),
  consentScope: z.array(z.nativeEnum(ConsentPurpose)).min(1),
});

export type RegisterConsentDto = z.infer<typeof RegisterConsentSchema>;
