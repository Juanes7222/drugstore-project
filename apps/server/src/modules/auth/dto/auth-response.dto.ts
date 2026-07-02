import { User } from '@pharmacy/shared-types';

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresAt!: Date;
  user!: Omit<User, 'passwordHash' | 'passwordAlgorithm'>;

  constructor(data?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    user: Omit<User, 'passwordHash' | 'passwordAlgorithm'>;
  }) {
    if (data) {
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.expiresAt = data.expiresAt;
      this.user = data.user;
    }
  }
}
