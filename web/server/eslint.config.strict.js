/**
 * ESLint strict configuration for CI
 *
 * Same as base config but with Prisma rules set to 'error' instead of 'warn'
 */

import tseslint from 'typescript-eslint';
import noUnboundedPrismaInclude from './eslint-rules/no-unbounded-prisma-include.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Ignore node_modules and build output
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'eslint-rules/**',
      'next-env.d.ts',
    ],
  },

  // TypeScript configuration
  ...tseslint.configs.recommended,

  // Custom Prisma rules - STRICT MODE (error instead of warn)
  {
    files: ['**/*.ts', '**/*.tsx'],

    plugins: {
      '@mlop': {
        rules: {
          'no-unbounded-prisma-include': noUnboundedPrismaInclude,
        },
      },
    },

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',

      // ERROR mode for CI - fails build on unbounded includes
      '@mlop/no-unbounded-prisma-include': [
        'error',
        {
          allowedRelations: [
            'organization',
            'user',
            'project',
            'apiKey',
          ],
        },
      ],
    },
  },
];
