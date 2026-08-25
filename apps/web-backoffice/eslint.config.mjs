import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
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
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);