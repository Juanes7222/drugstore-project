// ESLint flat config for apps/pos-desktop (ESLint 10 + typescript-eslint).
//
// Mirrors apps/server's pragmatic stance: correctness rules enforced, style
// rules warn (formatting debt paid down incrementally), liberal `any` usage
// tolerated until a typed-any cleanup lands. React/TSX files share the same
// TypeScript rules; Vitest files (globals: true in vite.config.ts) skip
// no-undef and the unsafe-function relaxations their idioms need.
//
// The codebase predates linting, so ESLint 10's new no-useless-assignment
// rule is disabled: it fires on existing mutating-assignment idioms across
// the tree and is noise until those files are touched anyway.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettier from 'eslint-plugin-prettier';

export default tseslint.defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src-tauri/**',
      'generated/**',
    ],
  },
  {
    // typescript-eslint >=8.66 infers tsconfigRootDir from the directories of
    // every eslint.config.* loaded in-process. Editor integrations load all
    // apps' configs into one ESLint instance, so inference sees multiple
    // candidates and fails parsing. Pin it per app to skip inference.
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      // Webview runtime: the renderer runs in the Tauri webview, not Node.
      globals: { ...globals.browser },
    },
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      // Repo style: single quotes, repo files are CRLF on Windows.
      'prettier/prettier': ['warn', { singleQuote: false, endOfLine: 'auto' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Pre-existing debt, disabled until the files that trip them are
      // touched anyway: ESLint 10's useless-assignment fires on mutating
      // idioms across the tree; NBSP inside Spanish strings; class/interface
      // merging and empty object types predate the lint config.
      'no-useless-assignment': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // React hooks linting (React 19). Existing files carry eslint-disable
    // directives for exhaustive-deps; the plugin makes them meaningful.
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Build/test tooling runs on Node, not in the webview.
    files: [
      'vite.config.ts',
      'vitest.setup.ts',
      'wdio.conf.ts',
      'eslint.config.js',
      'e2e/**/*.{js,mjs,ts}',
      'test/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Dev-only browser polyfills reference the Node globals they polyfill.
    files: ['src/renderer/dev/node-polyfills.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Vitest runs with globals: true — describe/it/expect are runtime
    // globals, not imports, so the recommended no-undef must not apply.
    files: ['**/*.{test,spec}.{ts,tsx}', '**/vitest.setup.ts'],
    rules: {
      'no-undef': 'off',
      // Test idiom: mock callbacks typed as Function / expect.any(Function).
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  eslintConfigPrettier,
);