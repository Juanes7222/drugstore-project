import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.spec.json',
      useESM: true,
      diagnostics: false,
    }],
  },
  moduleNameMapper: {
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
    '^@pharmacy/database$':
      '<rootDir>/../../packages/database/src/index.ts',
    '^@pharmacy/infisical-config$':
      '<rootDir>/../../packages/infisical-config/src/index.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/*.module.ts',
    '!src/**/*.schema.ts',
    '!src/**/*.exception.ts',
    '!src/**/*.constants.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/app.module.ts',
    // SDK/crypto/network-bound files: signing and SOAP transmission require
    // real DIAN-shaped certificates and live HTTP. They are exercised by the
    // DIAN habilitación sandbox integration suite instead of unit mocks.
    '!src/modules/fiscal-processing/signing/xades-signer.ts',
    '!src/modules/fiscal-processing/soap/soap-signer.ts',
    '!src/modules/fiscal-processing/soap/dian-http-client.ts',
    '!src/modules/fiscal-processing/adapters/soap-fiscal-transmission.adapter.ts',
  ],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

export default config;
