import { z } from 'zod';

export const ActivateSchema = z.object({
  code: z.string().min(10).max(50),
  hardwareFingerprint: z.string().min(10).max(256),
  workstationName: z.string().min(2).max(200),
  locationName: z.string().min(2).max(300).optional(),
  locationAddress: z.string().max(500).optional(),
  locationCity: z.string().max(200).optional(),
  locationRegion: z.string().max(200).optional(),
});

export const GenerateActivationCodeSchema = z.object({
  type: z.enum(['SUBSCRIPTION', 'WORKSTATION']).optional().default('WORKSTATION'),
  locationId: z.string().uuid().optional().nullable(),
});

export type ActivateDto = z.infer<typeof ActivateSchema>;
export type GenerateActivationCodeDto = z.infer<typeof GenerateActivationCodeSchema>;
