// ImportParseCache is a fail-tolerant Redis wrapper: every Redis failure
// must degrade to re-parsing, never to an import error. The ioredis client
// is mocked at module level so no test can reach a real connection.
jest.mock('ioredis', () => {
  // The constructor must be a jest.fn too: the spec resets it and reads
  // mock.instances to reach the per-instance method mocks.
  const MockRedis = jest.fn().mockImplementation(function (this: any) {
    this.get = jest.fn();
    this.set = jest.fn();
    this.del = jest.fn();
    this.on = jest.fn();
    this.connect = jest.fn().mockResolvedValue(undefined);
  });
  return { __esModule: true, default: MockRedis };
});

import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { ImportParseCache, CachedParseResult } from './import-parse-cache';

const REDIS_URL = 'redis://localhost:6379';

const MockRedisClass = Redis as unknown as jest.Mock;

interface MockRedisClient {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  on: jest.Mock;
  connect: jest.Mock;
}

function buildConfig(url: string | undefined): ConfigService {
  return { get: jest.fn().mockReturnValue(url) } as unknown as ConfigService;
}

function lastClient(): MockRedisClient {
  return MockRedisClass.mock.instances[
    MockRedisClass.mock.instances.length - 1
  ] as unknown as MockRedisClient;
}

function buildCachedResult(): CachedParseResult {
  return {
    totalRows: 2,
    valid: [{ rowNumber: 2, data: { internalCode: 'P-1' } }],
    errors: [],
    rawRows: [[2, { 'Codigo interno': 'P-1' }]],
  };
}

describe('ImportParseCache', () => {
  let cache: ImportParseCache;
  let client: MockRedisClient;

  beforeEach(() => {
    MockRedisClass.mockClear();
    cache = new ImportParseCache(buildConfig(REDIS_URL));
    client = lastClient();
  });

  it('creates a lazy Redis client with a one-shot retry policy and connects eagerly', () => {
    expect(MockRedisClass).toHaveBeenCalledTimes(1);
    expect(MockRedisClass).toHaveBeenCalledWith(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('registers an error listener that tolerates Redis errors without throwing', () => {
    const handler = client.on.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1] as (error: Error) => void;

    expect(() => handler(new Error('connection refused'))).not.toThrow();
  });

  it('returns the parsed payload on a cache hit', async () => {
    const payload = buildCachedResult();
    client.get.mockResolvedValue(JSON.stringify(payload));

    const result = await cache.get('import-1');

    expect(result).toEqual(payload);
    expect(client.get).toHaveBeenCalledWith('import:parse:import-1');
  });

  it('returns null when the key is absent', async () => {
    client.get.mockResolvedValue(null);

    const result = await cache.get('import-1');

    expect(result).toBeNull();
  });

  it('returns null instead of throwing when the cached JSON is corrupt', async () => {
    client.get.mockResolvedValue('{not-json');

    await expect(cache.get('import-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the Redis read fails', async () => {
    client.get.mockRejectedValue(new Error('redis down'));

    await expect(cache.get('import-1')).resolves.toBeNull();
  });

  it('stores the result as JSON with a 900 second TTL', async () => {
    const payload = buildCachedResult();
    client.set.mockResolvedValue('OK');

    await cache.set('import-1', payload);

    expect(client.set).toHaveBeenCalledWith(
      'import:parse:import-1',
      JSON.stringify(payload),
      'EX',
      900,
    );
  });

  it('does not throw when the Redis write fails', async () => {
    client.set.mockRejectedValue(new Error('redis down'));

    await expect(
      cache.set('import-1', buildCachedResult()),
    ).resolves.toBeUndefined();
  });

  it('deletes the key on del', async () => {
    client.del.mockResolvedValue(1);

    await cache.del('import-1');

    expect(client.del).toHaveBeenCalledWith('import:parse:import-1');
  });

  it('does not throw when the Redis delete fails', async () => {
    client.del.mockRejectedValue(new Error('redis down'));

    await expect(cache.del('import-1')).resolves.toBeUndefined();
  });

  describe('without REDIS_URL', () => {
    let noUrlCache: ImportParseCache;

    beforeEach(() => {
      // The outer beforeEach already created a client; drop it so the
      // "never creates a Redis client" assertion sees a clean slate.
      MockRedisClass.mockClear();
      noUrlCache = new ImportParseCache(buildConfig(undefined));
    });

    it('never creates a Redis client', () => {
      expect(MockRedisClass).not.toHaveBeenCalled();
    });

    it('treats get, set and del as no-ops', async () => {
      await expect(noUrlCache.get('import-1')).resolves.toBeNull();
      await expect(
        noUrlCache.set('import-1', buildCachedResult()),
      ).resolves.toBeUndefined();
      await expect(noUrlCache.del('import-1')).resolves.toBeUndefined();
    });
  });
});
