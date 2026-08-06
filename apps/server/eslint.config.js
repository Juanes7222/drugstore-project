// ESLint flat config for apps/server (ESLint 10 + typescript-eslint).
//
// The codebase predates linting, so this config is deliberately pragmatic:
// correctness rules are enforced, style rules warn (formatting debt is paid
// down incrementally), and rules that would flag the existing liberal `any`
// usage are disabled until the typed-any cleanup reaches each module.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettier from 'eslint-plugin-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'generated/**',
      'node_modules/**',
      'coverage/**',
      'src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      // Repo style: single quotes, repo files are CRLF on Windows.
      'prettier/prettier': ['warn', { singleQuote: true, endOfLine: 'auto' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      // Jest idiom: expect.any(Function) / mock callbacks typed as Function.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Specs build Prisma.Decimal via require('@pharmacy/database') as an ESM
      // interop workaround; runtime code remains import-only.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  eslintConfigPrettier,
);
