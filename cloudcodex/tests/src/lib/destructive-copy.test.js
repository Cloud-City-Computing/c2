/**
 * Cloud Codex - the destructive confirmations name what is lost and what stays (W6-CDX-39, Task 2.5, momus 4).
 * Each sentence was checked against the delete it confirms: the FK actions in init.sql and the statement in the
 * route (routes/workspaces.js, squads.js, archives.js, routes/admin.js). Each message names one lost thing and one
 * thing that stays, and says it cannot be undone where that is true.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import * as copy from '../../../src/lib/destructive-copy.js';

describe('destructive copy names what is lost and what stays', () => {
  it('removing a squad member: the squad access goes; their own documents and direct grants stay', () => {
    const m = copy.squadMemberRemove('Dana');
    expect(m.title).toBe('Remove Dana from this squad?');
    expect(m.message).toMatch(/lose the squad/i);
    expect(m.message).toMatch(/documents[^.]*stay/i);
  });

  it('deleting a squad: members lose the squad; its archives stay, with no squad', () => {
    const m = copy.squadDelete('Engineering');
    expect(m.message).toMatch(/members/i);
    expect(m.message).toMatch(/archives .*stay/i);
    expect(m.message).toMatch(/no squad/i);
  });

  it('deleting a workspace: its squads go; its archives and documents stay, with no squad', () => {
    const m = copy.workspaceDelete('Acme');
    expect(m.message).toMatch(/squads .*(removed|deleted|go)/i);
    expect(m.message).toMatch(/archives .*stay/i);
    expect(m.message).not.toMatch(/archives, and logs/);
  });

  it('deleting a user: sessions, comments and memberships go; their documents stay with no author', () => {
    const m = copy.userDelete('bob');
    expect(m.message).toMatch(/sessions/);
    expect(m.message).toMatch(/comments/);
    expect(m.message).toMatch(/documents .*stay/i);
    expect(m.message).toMatch(/cannot be undone/i);
  });

  it('deleting a document: its versions, comments and images go with it', () => {
    const m = copy.logDelete('API Overview');
    expect(m.message).toMatch(/versions/);
    expect(m.message).toMatch(/comments/);
    expect(m.message).toMatch(/cannot be undone/i);
  });

  it('deleting an archive: its documents and everything in them go', () => {
    const m = copy.archiveDelete('Runbooks');
    expect(m.message).toMatch(/documents/);
    expect(m.message).toMatch(/versions and comments/);
    expect(m.message).toMatch(/cannot be undone/i);
  });

  // W6-CDX-42, X8: routes/admin.js DELETE FROM user_invitations. The invitation's link stops working; nothing else goes.
  it('revoking an invitation: the link stops working, and the address can be invited again', () => {
    const m = copy.invitationRevoke('pending@example.test');
    expect(m.title).toBe('Revoke the invitation to pending@example.test?');
    expect(m.message).toMatch(/link .*stop/i);
    expect(m.message).toMatch(/invited again/i);
  });

  it('removing a repository from an archive: the link goes; the documents stay', () => {
    const m = copy.repoRemove('acme/api');
    expect(m.message).toMatch(/documents .*not deleted|documents .*stay/i);
  });
});
