import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  modulePaths: ['<rootDir>/../../node_modules/.pnpm/node_modules'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
    '^@pharmacy/database$': '<rootDir>/../../packages/database/src/index.ts',
    '^@pharmacy/infisical-config$':
      '<rootDir>/../../packages/infisical-config/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, diagnostics: false }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/*.module.ts',
    '!src/**/*.schema.ts',
    '!src/**/*.exception.ts',
    '!src/**/*.entity.ts',
    '!src/**/*.constants.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/app.module.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
