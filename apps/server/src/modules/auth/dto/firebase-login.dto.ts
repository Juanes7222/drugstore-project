import { z } from 'zod';

export const FirebaseLoginSchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
  workstationId: z.string().min(1, 'Workstation ID is required'),
  hardwareFingerprint: z.string().optional(),
  deviceInfo: z.string().optional(),
});

export class FirebaseLoginDto implements z.infer<typeof FirebaseLoginSchema> {
  idToken!: string;
  workstationId!: string;
  hardwareFingerprint?: string;
  deviceInfo?: string;
}
