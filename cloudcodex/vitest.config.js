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
      // Thresholds set to actually-achieved coverage minus a small buffer.
      // Anything that dips meaningfully below the achieved coverage will
      // fail CI — but normal day-to-day churn (a few uncovered lines) won't.
      // Numbers are deliberately conservative on directories that are
      // partially tested (services/collab.js, src/components/) so unrelated
      // PRs aren't blocked by their pre-existing gaps.
      thresholds: {
        // Global floor — pages/, large untested components, and src/extensions
        // pull this down. Set just under achieved (46.25% lines).
        lines: 43,
        statements: 40,
        branches: 33,
        functions: 26,

        // Well-tested security-critical modules.
        'routes/helpers/**': { lines: 88, statements: 85, branches: 65, functions: 90 },
        'middleware/**': { lines: 80, statements: 78, branches: 70, functions: 70 },

        // Routes — strong coverage already, locked in.
        'routes/auth.js': { lines: 85, statements: 85, branches: 82, functions: 95 },
        'routes/admin.js': { lines: 90, statements: 90, branches: 88, functions: 90 },
        'routes/archives.js': { lines: 90, statements: 88, branches: 75, functions: 90 },
        'routes/comments.js': { lines: 92, statements: 90, branches: 85, functions: 95 },
        'routes/documents.js': { lines: 95, statements: 92, branches: 88, functions: 88 },
        'routes/favorites.js': { lines: 80, statements: 80, branches: 70, functions: 80 },
        'routes/notifications.js': { lines: 95, statements: 95, branches: 88, functions: 95 },
        'routes/squads.js': { lines: 85, statements: 75, branches: 65, functions: 95 },
        'routes/watches.js': { lines: 85, statements: 85, branches: 73, functions: 95 },

        // Services.
        'services/email.js': { lines: 95, statements: 95, branches: 70, functions: 95 },
        'services/email-templates.js': { lines: 95, statements: 90, branches: 90, functions: 95 },
        'services/notifications.js': { lines: 90, statements: 88, branches: 80, functions: 88 },
        // collab.js — was 25%, ratcheted to 65% after the gap-fix pass.
        'services/collab.js': { lines: 65, statements: 65, branches: 50, functions: 75 },

        // Framework files (newly tested in the gap-fix pass).
        'mysql_connect.js': { lines: 85, statements: 85, branches: 80, functions: 90 },
        'app.js': { lines: 75, statements: 75, branches: 5, functions: 90 },

        // Frontend pure logic.
        'src/editorUtils.js': { lines: 95, statements: 95, branches: 88, functions: 95 },
        'src/userPrefs.js': { lines: 95, statements: 95, branches: 80, functions: 95 },
        'src/util.jsx': { lines: 65, statements: 55, branches: 50, functions: 22 },
        'src/lib/**': { lines: 90, statements: 90, branches: 70, functions: 80 },

        // Hooks.
        'src/hooks/useClickOutside.js': { lines: 90, statements: 90, branches: 80, functions: 90 },
        'src/hooks/usePresence.js': { lines: 95, statements: 95, branches: 80, functions: 90 },
        'src/hooks/useGitHubStatus.jsx': { lines: 85, statements: 85, branches: 75, functions: 85 },
        'src/hooks/useGitHubLink.js': { lines: 88, statements: 85, branches: 65, functions: 95 },
        'src/hooks/useNotificationChannel.js': { lines: 88, statements: 85, branches: 80, functions: 85 },
      },
    },
  },
});
