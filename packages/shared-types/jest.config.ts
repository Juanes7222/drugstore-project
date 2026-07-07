import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
  coverageDirectory: './coverage',
};

export default config;
