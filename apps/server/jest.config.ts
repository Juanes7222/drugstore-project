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
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pharmacy/shared-types$':
      '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@pharmacy/shared-validation$':
      '<rootDir>/../../packages/shared-validation/src/index.ts',
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
