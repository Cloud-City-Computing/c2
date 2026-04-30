/**
 * Cloud Codex - Frontend Test Setup
 *
 * Loaded automatically before every test in the `frontend` Vitest project.
 * Provides jest-dom matchers, ensures localStorage/sessionStorage are clean
 * between tests, and resets the document body so component tests start from
 * a known state.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') {
    window.localStorage?.clear();
    window.sessionStorage?.clear();
  }
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});
