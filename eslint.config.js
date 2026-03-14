import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['**/node_modules/', '**/dist/', '**/drizzle/', '**/*.d.ts', 'scripts/'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-aware is too slow for this codebase)
  ...tseslint.configs.recommended,

  // Shared overrides — bug-catching only, no style rules
  {
    rules: {
      // Downgrade things that are noisy but not bugs
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-constant-binary-expression': 'error',
    },
  },

  // Allow Express declaration merging via namespace
  {
    files: ['apps/api/src/shared/middleware/*.ts'],
    rules: {
      '@typescript-eslint/no-namespace': 'off',
    },
  },

  // React hooks rules — web app only
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
