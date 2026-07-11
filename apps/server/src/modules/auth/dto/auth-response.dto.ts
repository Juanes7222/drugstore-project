import { User } from '@pharmacy/shared-types';

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresAt!: Date;
  user!: Omit<User, 'passwordHash' | 'passwordAlgorithm' | 'pinHash'>;
  sessionId?: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  evictedSessionId?: string;

  constructor(data?: Partial<AuthResponseDto>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}
