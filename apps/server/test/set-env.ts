// Set test environment variables before any module is compiled.
// This file runs via jest.config setupFiles, so it executes in the same
// Node.js context as the tests, ensuring ConfigModule.forRoot() picks them up.

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db';

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ??
  'test-access-secret-key-32-chars-minimum!!';

process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ??
  'test-refresh-secret-key-32-chars-minimum';

process.env.JWT_ACCESS_TTL_SECONDS = process.env.JWT_ACCESS_TTL_SECONDS ?? '900';
process.env.JWT_REFRESH_TTL_SECONDS = process.env.JWT_REFRESH_TTL_SECONDS ?? '604800';
process.env.PORT = process.env.PORT ?? '3001';
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
