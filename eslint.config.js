const js = require('@eslint/js');
const typescript = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json'
      },
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    plugins: {
      '@typescript-eslint': typescript
    },
    rules: {
      ...typescript.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_|^e$|^token$',
        varsIgnorePattern: '^_' 
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-case-declarations': 'off',
      'no-fallthrough': 'off'
    }
  },
  {
    ignores: [
      'out/**',
      'dist/**',
      '*.config.js',
      '.vscode-test/**',
      'node_modules/**',
      '.yarn/**'
    ]
  }
];