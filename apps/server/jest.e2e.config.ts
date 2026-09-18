import type { Config } from 'jest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive paths from the config file location (this file is loaded as an ES
// module by jest's TS config reader, so __dirname is unavailable).
const configDir = path.dirname(fileURLToPath(import.meta.url));

const config: Config = {
  globalSetup: path.join(configDir, 'test/global-setup.cjs'),
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.e2e.json',
      useESM: true,
      diagnostics: false,
    }],
    // ESM-only packages reachable from CJS deps: jwks-rsa (a firebase-admin
    // dependency) does require('jose') and jose@6 ships ESM only
    // ("type": "module"). jest-runtime parses those files as CommonJS and
    // dies on the first `import` token, so they go through a custom
    // esbuild-based transformer (no babel preset available in this repo).
    // Transform KEYS are compiled with `new RegExp(key)` WITHOUT
    // replacePathSepForRegex, so on win32 a '/' would never match the
    // backslash paths jest passes in. This key deliberately avoids
    // backslashes entirely: '.' matches any separator and '[.]' is a
    // backslash-free literal dot.
    'node_modules.jose.dist.+[.]js$':
      '<rootDir>/test/transform-esm-dep.cjs',
  },
  // The default ignore pattern skips every node_modules file, which would
  // prevent the jose transformer above from running. Under pnpm the real
  // packages live in node_modules/.pnpm/<name>@<ver>/node_modules/<name>,
  // and a negative lookahead like "node_modules/(?!.*jose)" cannot work:
  // the regex engine matches at EVERY node_modules occurrence, and at the
  // innermost one the remaining path no longer contains "jose", so the file
  // is always ignored. Anchoring the exception right after ".pnpm/" is
  // position-safe: every package except jose is skipped there, and the
  // inner "node_modules/<name>" segments never match ".pnpm".
  // Unlike transform keys, this pattern IS normalized with
  // replacePathSepForRegex, so plain '/' is correct here.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!jose@)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
    // Runtime Prisma: a prebuilt CJS bundle of packages/database/dist, built
    // and ESM-patched by test/global-setup.cjs when stale (the type-checking
    // counterpart is the @prisma/client path mapping in tsconfig.e2e.json).
    // The ESM output of that package cannot execute under jest's CJS runtime,
    // and apps/server has no generated client under node_modules/.prisma.
    '^@pharmacy/database$':
      '<rootDir>/test/generated/database-cjs/database.cjs',
    '^@prisma/client$':
      '<rootDir>/test/generated/database-cjs/database.cjs',
    // Unit-test helper import kept working in the e2e config too.
    '^@pharmacy/database/enums$':
      '<rootDir>/test/generated/database-cjs/database.cjs',
  },
  setupFiles: ['./test/set-env.ts'],
  // Production wiring (main.ts) patches BigInt.prototype.toJSON so Prisma
  // BigInt columns (Sale.localNumber) serialize in JSON responses; the specs
  // mount AppModule without bootstrap(), so the polyfill is applied here.
  setupFilesAfterEnv: ['./test/setup-bigint-polyfill.ts'],
  coverageDirectory: './coverage-e2e',
  collectCoverage: false,
  verbose: true,
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: true,
};

export default config;
