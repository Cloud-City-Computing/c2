/**
 * Cloud Codex - The client's dead-session message and session-ended signal (momus items 3 and 1)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import * as shared from '../../../services/session-messages.js';
import {
  DEAD_SESSION_MESSAGE,
  SESSION_ENDED_EVENT,
  announceSessionEnded,
  onSessionEnded,
} from '../../../src/lib/session-ended.js';

describe('the dead-session message', () => {
  it('is the one string the server emits, and the client reads the same constant', () => {
    expect(DEAD_SESSION_MESSAGE).toBe(shared.DEAD_SESSION_MESSAGE);
    expect(DEAD_SESSION_MESSAGE).toBe('Invalid or expired session');
  });

  it('pins the collab close for a signed-out socket to the shared code and reason', () => {
    expect(shared.SIGNED_OUT_SOCKET_CLOSE).toEqual({ code: 4004, reason: 'Signed out' });
  });
});

describe('the session-ended signal', () => {
  it('reaches a subscriber once per announcement, and stops after unsubscribe', () => {
    const seen = vi.fn();
    const stop = onSessionEnded(seen);
    announceSessionEnded();
    expect(seen).toHaveBeenCalledOnce();
    stop();
    announceSessionEnded();
    expect(seen).toHaveBeenCalledOnce();
    expect(SESSION_ENDED_EVENT).toBe('c2:session-ended');
  });
});
