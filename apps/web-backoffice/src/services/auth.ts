import { api } from './api';
import type { LoginResponse, AuthUser } from '../types/backoffice';

export interface LoginCredentials {
  identifier: string;
  secret: string;
  workstationId: string;
}

export async function login(
  credentials: LoginCredentials,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', {
    identifier: credentials.identifier,
    secret: credentials.secret,
    sessionType: 'PASSWORD',
    workstationId: credentials.workstationId,
    deviceInfo: `web-backoffice/${navigator.userAgent ?? 'unknown'}`,
  });
  return data;
}

export interface TwoFactorCredentials {
  challengeToken: string;
  totpCode?: string;
  backupCode?: string;
}

export async function completeTwoFactor(
  credentials: TwoFactorCredentials,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login/2fa', {
    challengeToken: credentials.challengeToken,
    totpCode: credentials.totpCode,
    backupCode: credentials.backupCode,
  });
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}