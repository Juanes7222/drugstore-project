import { z } from 'zod';

export const FirebaseLoginSchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
  // Optional: web backoffice logins have no POS terminal and fall back to
  // the shared WEB_ADMIN virtual workstation server-side.
  workstationId: z.string().min(1).optional(),
  hardwareFingerprint: z.string().optional(),
  deviceInfo: z.string().optional(),
});

export class FirebaseLoginDto implements z.infer<typeof FirebaseLoginSchema> {
  idToken!: string;
  workstationId?: string;
  hardwareFingerprint?: string;
  deviceInfo?: string;
}
