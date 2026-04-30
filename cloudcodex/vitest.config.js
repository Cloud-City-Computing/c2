/**
 * Cloud Codex - Vitest Configuration
 *
 * Two projects: a Node backend project for routes/middleware/services tests,
 * and a jsdom frontend project for src/ component, hook, and utility tests.
 * Coverage is configured at the top level so a single `npm run test:coverage`
 * run produces a unified report across both projects.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [],
        test: {
          name: 'backend',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/setup.js'],
          include: [
            'tests/routes/**/*.test.{js,jsx}',
            'tests/middleware/**/*.test.{js,jsx}',
            'tests/services/**/*.test.{js,jsx}',
            'tests/helpers/**/*.test.{js,jsx}',
            'tests/extensions/**/*.test.{js,jsx}',
            'tests/*.test.{js,jsx}',
          ],
          testTimeout: 10000,
          hookTimeout: 10000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'frontend',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./tests/setup.frontend.js'],
          include: ['tests/src/**/*.test.{js,jsx}'],
          testTimeout: 10000,
          hookTimeout: 10000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'routes/**/*.js',
        'middleware/**/*.js',
        'services/**/*.js',
        'src/**/*.{js,jsx}',
        'mysql_connect.js',
        'app.js',
        'server.js',
      ],
      exclude: [
        'tests/**',
        'dist/**',
        'public/**',
        'node_modules/**',
        '**/*.config.{js,cjs,mjs}',
        'src/main.jsx',
      ],
      // Thresholds are intentionally absent during the test-coverage push.
      // Phase 5 ratchets them up to actually-achieved numbers minus a small
      // buffer so future regressions fail CI.
      thresholds: {
        autoUpdate: false,
      },
    },
  },
});
