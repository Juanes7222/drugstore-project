import { User } from '@pharmacy/shared-types';

export interface OfflineTokenDto {
  token: string;
  expiresAt: Date;
}

export interface CredentialVerificationKeyDto {
  encryptedBlob: string;
  keyFingerprint: string;
  version: number;
}

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresAt!: Date;
  user!: Omit<User, 'passwordHash' | 'passwordAlgorithm' | 'pinHash'>;
  sessionId?: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  evictedSessionId?: string;
  offlineToken?: OfflineTokenDto;
  credentialVerificationKey?: CredentialVerificationKeyDto;

  constructor(data?: Partial<AuthResponseDto>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}
