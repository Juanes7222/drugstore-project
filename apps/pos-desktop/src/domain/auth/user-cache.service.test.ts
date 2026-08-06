/**
 * User cache service — upsertUserIdentity contract.
 *
 * Identity-only rows (no credentials) exist so reports can resolve
 * display names instead of raw IDs.  They must upsert idempotently,
 * refresh identity fields on conflict, and never allow local password
 * verification (the server stays authoritative for credentials).
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';
import { createUserCacheService } from './user-cache.service';

const pgHolder = vi.hoisted(() => ({ pg: null as PGlite | null }));

vi.mock('../../infrastructure/local-database', () => ({
  getLocalDatabase: vi.fn().mockImplementation(async () => ({
    client: pgHolder.pg,
  })),
  closeLocalDatabase: vi.fn(),
}));

describe('createUserCacheService.upsertUserIdentity', () => {
  beforeEach(async () => {
    const pg = new PGlite('memory://');
    await pg.exec(LOCAL_SCHEMA_SQL);
    pgHolder.pg = pg;
  });

  afterEach(async () => {
    await pgHolder.pg?.close();
    pgHolder.pg = null;
  });

  it('creates an identity-only row that reports can join for names', async () => {
    const service = createUserCacheService();
    await service.upsertUserIdentity({
      id: 'user_cashier_1',
      username: 'cashier1',
      displayName: 'María Rodríguez',
      role: 'CASHIER',
    });

    const user = await service.getUser('user_cashier_1');
    expect(user).toMatchObject({
      id: 'user_cashier_1',
      username: 'cashier1',
      displayName: 'María Rodríguez',
      role: 'CASHIER',
    });
  });

  it('refreshes identity fields on conflict without touching credentials', async () => {
    const service = createUserCacheService();
    await service.upsertUserIdentity({
      id: 'u1',
      username: 'a',
      displayName: 'A',
      role: 'CASHIER',
    });

    await service.upsertUserIdentity({
      id: 'u1',
      username: 'a',
      displayName: 'A Renovada',
      role: 'MANAGER',
    });

    const user = await service.getUser('u1');
    expect(user?.displayName).toBe('A Renovada');
    expect(user?.role).toBe('MANAGER');
    // Credentials were never written.
    expect(user?.passwordVersion).toBe(1);
    expect(user?.createdLocally).toBe(false);
  });

  it('identity-only rows cannot verify a password', async () => {
    const service = createUserCacheService();
    await service.upsertUserIdentity({
      id: 'u2',
      username: 'b',
      displayName: 'B',
      role: 'CASHIER',
    });

    const result = await service.verifyPassword('u2', 'anything');
    expect(result.valid).toBe(false);
    expect(result.locked).toBe(false);
  });

  it('identity-only rows never accumulate failed attempts or lock the user', async () => {
    const service = createUserCacheService();
    await service.upsertUserIdentity({
      id: 'u3',
      username: 'c',
      displayName: 'C',
      role: 'CASHIER',
    });

    // Far beyond the lock threshold — the row must never lock because it
    // cannot verify locally (the server stays authoritative).
    for (let i = 0; i < 12; i++) {
      const result = await service.verifyPassword('u3', 'wrong');
      expect(result.valid).toBe(false);
      expect(result.locked).toBe(false);
    }

    const user = await service.getUser('u3');
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });
});
