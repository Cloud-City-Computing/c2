/**
 * Cloud Codex - the copy of the destructive confirmations (W6-CDX-39, Task 2.5)
 *
 * Each function returns { title, message } for a ConfirmDialog. A message names what is lost and what stays, and
 * says it cannot be undone where that is true. Every claim is checked against the delete it confirms: the FK
 * actions in init.sql (squads.workspace_id and logs.archive_id CASCADE, archives.squad_id, logs.created_by and
 * workspaces.owner_id SET NULL) and the statement each route runs.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** routes/squads.js: DELETE FROM squad_members for one user. Their archives, documents and direct grants stay. */
export const squadMemberRemove = (name) => ({
  title: `Remove ${name} from this squad?`,
  message: "They lose the squad's access to its archives. Their own documents, and archive access granted to them directly, stay.",
});

/** routes/squads.js: DELETE FROM squads. Members and invitations cascade; archives SET NULL and stay. */
export const squadDelete = (name) => ({
  title: `Delete ${name}?`,
  message: "Its members lose the squad's access. Its archives and documents stay, with no squad: only their creator, an explicit grant or an admin can open them now.",
});

/** routes/workspaces.js and routes/admin.js: DELETE FROM workspaces. Squads cascade; archives and documents stay. */
export const workspaceDelete = (name) => ({
  title: `Delete ${name}?`,
  message: 'Its squads are deleted, with their memberships. Its archives and documents stay, with no squad. This cannot be undone.',
});

/** routes/admin.js: DELETE FROM users. Sessions, comments, favorites and memberships cascade; documents stay, unattributed. */
export const userDelete = (name) => ({
  title: `Delete user "${name}"?`,
  message: 'This removes their sign-in sessions, comments, favorites and squad and archive memberships. Their documents stay, with no author. This cannot be undone.',
});

/** routes/archives.js: DELETE FROM logs. Versions, comments, images, GitHub links and favorites cascade. */
export const logDelete = (title) => ({
  title: 'Delete document?',
  message: `Delete "${title}"? Its versions, comments, images and favorites go with it. This cannot be undone.`,
});

/** routes/archives.js: DELETE FROM archives. Its documents cascade, and with them their versions and comments. */
export const archiveDelete = (name) => ({
  title: 'Delete archive?',
  message: `Delete "${name}" and all its documents? Their versions and comments go too. This cannot be undone.`,
});

/** routes/admin.js: DELETE FROM user_invitations. The invitation's link stops working; nothing else is removed. */
export const invitationRevoke = (email) => ({
  title: `Revoke the invitation to ${email}?`,
  message: 'Its link stops working. The address can be invited again.',
});

/** routes/archives.js: DELETE FROM archive_repos. Only the link goes. */
export const repoRemove = (repo) => ({
  title: 'Remove repository?',
  message: `Remove "${repo}" from this archive? Its documents are not deleted.`,
});
