// @ts-check
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const tsParser = require('@typescript-eslint/parser')

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/dist-bundle/**',
      '**/node_modules/**',
      '**/coverage/**',
    ],
  },

  // Don't error on eslint-disable comments for rules from uninstalled plugins
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  // TypeScript files across all packages
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Core TypeScript rules from recommended
      ...tsPlugin.configs['recommended'].rules,

      // Allow void-returning arrow functions (common in React event handlers)
      '@typescript-eslint/no-floating-promises': 'off',

      // Allow underscore-prefixed unused vars (common convention)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Allow explicit `any` in limited cases — use sparingly
      '@typescript-eslint/no-explicit-any': 'error',

      // Allow require() only in config/script files
      '@typescript-eslint/no-require-imports': 'error',

      // Empty interfaces like `interface Foo extends Bar {}` are fine (common for component props)
      '@typescript-eslint/no-empty-object-type': 'off',

      // These are off because strict mode is enforced via tsc instead
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow empty catch blocks with a comment
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
