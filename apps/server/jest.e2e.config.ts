import type { Config } from 'jest';

const config: Config = {
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
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
    // Runtime Prisma: the generated CJS client at the workspace root. The
    // TS source barrel (packages/database/src/index.ts) re-exports the
    // generated client through './x.js' specifiers and import.meta, which
    // jest-resolve/ts-jest cannot execute; the generated client's own
    // runtime shape is identical.
    '^@pharmacy/database$': '<rootDir>/../../node_modules/.prisma/client',
    '^@prisma/client$': '<rootDir>/../../node_modules/.prisma/client',
  },
  setupFiles: ['./test/set-env.ts'],
  coverageDirectory: './coverage-e2e',
  collectCoverage: false,
  verbose: true,
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: true,
};

export default config;
