import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    plugins: {
      react,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // --- Variables ---
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-var': 'error',
      'prefer-const': 'error',

      // --- Code quality ---
      'no-console': ['warn', { allow: ['error'] }],  // allow console.error for error logging
      'eqeqeq': ['error', 'always'],                 // enforce === over ==
      'no-alert': 'error',                           // ban alert() — use inline status messages
      'no-implicit-coercion': 'error',               // ban !! and + coercions

      // --- Async ---
      'no-async-promise-executor': 'error',
      'require-await': 'warn',

      // --- React ---
      'react/jsx-no-useless-fragment': 'error',          // ban empty <> </> wrappers
      'react/self-closing-comp': 'error',                // enforce <div /> over <div></div>
      'react/no-danger': 'warn',                         // warn on dangerouslySetInnerHTML
      'react/jsx-handler-names': ['warn', {              // enforce on* naming for handlers
        eventHandlerPrefix: 'handle',
        eventHandlerPropPrefix: 'on',
      }],
      'react/no-direct-mutation-state': 'error',
      'react/jsx-key': 'error',                          // require key on mapped elements

      // --- React Hooks ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',             // catch missing useEffect deps
    },
  },
])