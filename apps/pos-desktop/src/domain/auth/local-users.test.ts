/**
 * Unit tests for local-users module — deriveCredentialFlags and
 * mapServerUserToLocalUserInfo.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveCredentialFlags,
  mapServerUserToLocalUserInfo,
} from './local-users';

describe('deriveCredentialFlags', () => {
  it('prefers explicit flags over the authMethod fallback', () => {
    const result = deriveCredentialFlags({
      hasPin: false,
      hasPassword: true,
      authMethod: 'PIN_ONLY',
    });

    expect(result.hasPin).toBe(false);
    expect(result.hasPassword).toBe(true);
  });

  it('uses explicit flags verbatim even when they contradict each other', () => {
    const result = deriveCredentialFlags({
      hasPin: true,
      hasPassword: true,
      authMethod: 'OAUTH_GOOGLE',
    });

    expect(result.hasPin).toBe(true);
    expect(result.hasPassword).toBe(true);
  });

  it('keeps the unspecified flag unknown when only hasPin is explicit', () => {
    const result = deriveCredentialFlags({ hasPin: true });

    expect(result.hasPin).toBe(true);
    expect(result.hasPassword).toBeUndefined();
  });

  it('maps PIN_ONLY to pin-available and password-absent', () => {
    const result = deriveCredentialFlags({ authMethod: 'PIN_ONLY' });

    expect(result).toEqual({ hasPin: true, hasPassword: false });
  });

  it('maps PASSWORD_ONLY to password-available and pin-absent', () => {
    const result = deriveCredentialFlags({ authMethod: 'PASSWORD_ONLY' });

    expect(result).toEqual({ hasPin: false, hasPassword: true });
  });

  it('maps PASSWORD_TOTP to password-available and pin-absent', () => {
    const result = deriveCredentialFlags({ authMethod: 'PASSWORD_TOTP' });

    expect(result).toEqual({ hasPin: false, hasPassword: true });
  });

  it('maps OAUTH_GOOGLE to both credentials absent', () => {
    const result = deriveCredentialFlags({ authMethod: 'OAUTH_GOOGLE' });

    expect(result).toEqual({ hasPin: false, hasPassword: false });
  });

  it('returns both flags unknown for an unrecognized authMethod', () => {
    const result = deriveCredentialFlags({ authMethod: 'TELEPATHY' });

    expect(result.hasPin).toBeUndefined();
    expect(result.hasPassword).toBeUndefined();
  });

  it('returns both flags unknown when the payload has neither flags nor authMethod', () => {
    const result = deriveCredentialFlags({});

    expect(result).toEqual({});
  });
});

describe('mapServerUserToLocalUserInfo', () => {
  it('maps displayName when present', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-1',
      displayName: 'Juan Pérez',
      role: 'CASHIER',
    });

    expect(result).toEqual({
      id: 'u-1',
      displayName: 'Juan Pérez',
      role: 'CASHIER',
      avatarUrl: null,
      avatarColor: null,
      username: '',
    });
  });

  it('falls back to fullName when displayName is absent', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-2',
      fullName: 'María Rodríguez',
      role: 'MANAGER',
    });

    expect(result.displayName).toBe('María Rodríguez');
  });

  it('defaults displayName to empty string when both displayName and fullName are absent', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-3',
      role: 'OWNER',
    });

    expect(result.displayName).toBe('');
  });

  it('passes through avatarUrl and avatarColor', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-4',
      displayName: 'Carlos',
      role: 'CASHIER',
      avatarUrl: 'https://example.com/avatar.png',
      avatarColor: '#FF5733',
    });

    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.avatarColor).toBe('#FF5733');
  });

  it('maps username when present', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-5',
      displayName: 'Luisa',
      role: 'CASHIER',
      username: 'luisa.garcia',
    });

    expect(result.username).toBe('luisa.garcia');
  });

  it('defaults username to empty string when absent', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-6',
      displayName: 'Pedro',
      role: 'CASHIER',
    });

    expect(result.username).toBe('');
  });

  it('coerces role as-is (caller must validate against RoleType)', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-7',
      displayName: 'Admin',
      role: 'ADMIN',
    });

    expect(result.role).toBe('ADMIN');
  });

  it('defaults avatarUrl and avatarColor to null when absent', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-8',
      displayName: 'Test',
      role: 'CASHIER',
    });

    expect(result.avatarUrl).toBeNull();
    expect(result.avatarColor).toBeNull();
  });

  it('spreads explicit credential flags onto the mapped user', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-9',
      displayName: 'Con credenciales',
      role: 'CASHIER',
      hasPin: true,
      hasPassword: true,
    });

    expect(result.hasPin).toBe(true);
    expect(result.hasPassword).toBe(true);
  });

  it('derives flags from authMethod when the server predates the booleans', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-10',
      displayName: 'Legacy server',
      role: 'MANAGER',
      authMethod: 'PIN_ONLY',
    });

    expect(result.hasPin).toBe(true);
    expect(result.hasPassword).toBe(false);
  });

  it('leaves both flags unset when the server reports nothing derivable', () => {
    const result = mapServerUserToLocalUserInfo({
      id: 'u-11',
      displayName: 'Sin señales',
      role: 'OWNER',
    });

    expect(result.hasPin).toBeUndefined();
    expect(result.hasPassword).toBeUndefined();
  });
});
