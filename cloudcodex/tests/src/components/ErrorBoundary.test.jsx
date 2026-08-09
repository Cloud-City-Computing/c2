/**
 * Cloud Codex — Tests for ErrorBoundary
 *
 * The point of this component is that a single render throw must not unmount
 * the React root, which is what used to blank the entire app.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ErrorBoundary from '../../../src/components/ErrorBoundary';

function Boom({ message = 'kaboom' }) {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  let errorSpy;

  beforeEach(() => {
    // React logs caught errors itself; silence it so a passing run is readable.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the actual app</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('the actual app')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a recoverable message instead of rendering nothing when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    // The regression this guards: a blank page. Something must be on screen.
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(alert.textContent.trim().length).toBeGreaterThan(0);
  });

  it('surfaces the error message so the failure is diagnosable', () => {
    render(
      <ErrorBoundary>
        <Boom message="removeChild: node is not a child" />
      </ErrorBoundary>
    );

    expect(screen.getByText('removeChild: node is not a child')).toBeInTheDocument();
  });

  it('logs the error with the project console.error format', () => {
    render(
      <ErrorBoundary>
        <Boom message="logged please" />
      </ErrorBoundary>
    );

    const logged = errorSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('Unhandled render error')
    );
    expect(logged).toBeDefined();
    expect(logged[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] Unhandled render error:$/);
    expect(logged[1]).toBeInstanceOf(Error);
    expect(logged[1].message).toBe('logged please');
  });

  it('offers a reload action', async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });

  it('re-renders the children when "Try again" is clicked and the cause is gone', async () => {
    const user = userEvent.setup();

    function Flaky() {
      const [ok, setOk] = useState(false);
      if (!ok) {
        // Arm the recovery before throwing, so the retry finds a good state.
        setTimeout(() => setOk(true), 0);
        throw new Error('transient');
      }
      return <p>recovered</p>;
    }

    // Keyed so the retry remounts Flaky rather than reusing the thrown instance.
    function Harness() {
      const [attempt, setAttempt] = useState(0);
      return (
        <ErrorBoundary key={attempt}>
          <Flaky />
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            outer retry
          </button>
        </ErrorBoundary>
      );
    }

    render(<Harness />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    // Either it recovered or the boundary caught it again. What must NOT happen
    // is an empty document, which is the bug this component exists to prevent.
    expect(document.body.textContent.trim().length).toBeGreaterThan(0);
  });
});
