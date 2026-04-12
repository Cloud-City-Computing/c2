/**
 * Cloud Codex — Admin Dashboard
 *
 * Dashboard-style admin console with sidebar navigation and
 * management panels for workspaces, users, squads, and live activity.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchAdminStatus,
  fetchAdminStats,
  fetchAdminWorkspaces,
  createAdminWorkspace,
  deleteAdminWorkspace,
  fetchAdminUsers,
  deleteAdminUser,
  fetchAdminUserPermissions,
  updateAdminUserPermissions,
  updateAdminUserAdmin,
  fetchAdminInvitations,
  createAdminInvitation,
  deleteAdminInvitation,
  fetchAdminSquads,
  fetchAdminSquadMembers,
  updateAdminSquadMember,
  removeAdminSquadMember,
  fetchAdminPresence,
  showModal,
  destroyModal,
  timeAgo,
} from '../util';
import ConfirmDialog from '../components/ConfirmDialog';
import { toastError } from '../components/Toast';

// ─── Overview Panel ─────────────────────────────────────────

function OverviewPanel() {
  const [stats, setStats] = useState(null);
  const [presence, setPresence] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchAdminStats();
      setStats(res.stats);
    } catch { /* ignore */ }
  }, []);

  const loadPresence = useCallback(async () => {
    try {
      const res = await fetchAdminPresence();
      setPresence(res);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadStats();
    loadPresence();
    const interval = setInterval(() => { loadStats(); loadPresence(); }, 15000);
    return () => clearInterval(interval);
  }, [loadStats, loadPresence]);

  const statItems = stats ? [
    { label: 'Users', value: stats.userCount, icon: '👤' },
    { label: 'Workspaces', value: stats.workspaceCount, icon: '🏢' },
    { label: 'Squads', value: stats.squadCount, icon: '👥' },
    { label: 'Archives', value: stats.archiveCount, icon: '📁' },
    { label: 'Logs', value: stats.logCount, icon: '📄' },
    { label: 'Pending Invites', value: stats.pendingInviteCount, icon: '✉' },
    { label: 'Online Now', value: stats.onlineUserCount ?? 0, icon: '🟢' },
    { label: 'Active Docs', value: stats.activeDocCount ?? 0, icon: '✏' },
  ] : [];

  return (
    <div className="admin-overview">
      {stats && (
        <div className="admin-stats">
          {statItems.map(item => (
            <div key={item.label} className="admin-stat-card">
              <span className="admin-stat-card__icon">{item.icon}</span>
              <span className="admin-stat-card__value">{item.value}</span>
              <span className="admin-stat-card__label">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="admin-panel">
        <div className="admin-panel__header">
          <h3>Live Activity</h3>
          <button className="btn btn-ghost btn-sm" onClick={loadPresence}>↻ Refresh</button>
        </div>
        {!presence ? (
          <p className="text-muted">Loading…</p>
        ) : presence.onlineUsers.length === 0 ? (
          <p className="text-muted">No users currently online.</p>
        ) : (
          <div className="admin-activity-list">
            {presence.onlineUsers.map(u => (
              <div key={u.id} className="admin-activity-item">
                <div className="admin-activity-item__user">
                  {u.avatar_url && <img src={u.avatar_url} alt="" className="admin-user-avatar" />}
                  <span className="admin-activity-item__name">{u.name}</span>
                  <span className="admin-online-dot" />
                </div>
                <div className="admin-activity-item__docs">
                  {u.editing.map((doc, i) => (
                    <span key={i} className="admin-activity-doc">
                      {doc.archive_name} / {doc.title}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────

function NewWorkspaceModal({ onCreated }) {
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [squadName, setSquadName] = useState('');
  const [archiveName, setArchiveName] = useState('');
  const [addSquad, setAddSquad] = useState(false);
  const [addArchive, setAddArchive] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Workspace name is required.'); return; }
    if (!ownerEmail.trim()) { setError('Owner email is required.'); return; }
    try {
      await createAdminWorkspace(name, ownerEmail, {
        squadName: addSquad ? squadName.trim() || undefined : undefined,
        archiveName: addSquad && addArchive ? archiveName.trim() || undefined : undefined,
      });
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating workspace.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Workspace</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="admin-workspace-name">Workspace Name:</label>
        <input id="admin-workspace-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />

        <label htmlFor="admin-workspace-owner">Owner Email:</label>
        <input id="admin-workspace-owner" type="email" value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="user@example.com" />

        <label className="setup-checkbox">
          <input type="checkbox" checked={addSquad} onChange={(e) => {
            setAddSquad(e.target.checked);
            if (!e.target.checked) setAddArchive(false);
          }} />
          Also create a squad
        </label>
        {addSquad && (
          <>
            <input type="text" value={squadName}
              onChange={(e) => setSquadName(e.target.value)}
              placeholder="e.g. Engineering"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            <label className="setup-checkbox">
              <input type="checkbox" checked={addArchive} onChange={(e) => setAddArchive(e.target.checked)} />
              Also create an archive
            </label>
            {addArchive && (
              <input type="text" value={archiveName}
                onChange={(e) => setArchiveName(e.target.value)}
                placeholder="e.g. Documentation"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            )}
          </>
        )}

        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function InviteUserModal({ onInvited }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!email.trim()) { setError('Email address is required.'); return; }
    try {
      const res = await createAdminInvitation(email);
      setSuccess(res.message);
      setEmail('');
      onInvited?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error sending invitation.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Invite User</h2>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      <div className="modal-form">
        <label htmlFor="invite-email">Email Address:</label>
        <input id="invite-email" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="newuser@example.com" />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Send Invitation</button>
      </div>
    </div>
  );
}

// ─── User Permissions Modal ─────────────────────────────────

function UserPermissionsModal({ user, onUpdated }) {
  const [perms, setPerms] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAdminUserPermissions(user.id)
      .then(res => setPerms(res.permissions))
      .catch(() => setPerms({ create_squad: false, create_archive: false, create_log: true }));
  }, [user.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAdminUserPermissions(user.id, perms);
      destroyModal();
      onUpdated?.();
    } catch (e) {
      toastError(e.body?.message ?? 'Error saving permissions.');
    }
    setSaving(false);
  };

  if (!perms) return <div className="modal-content"><p className="text-muted">Loading…</p></div>;

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Permissions — {user.name}</h2>
      <div className="modal-form admin-perms-form">
        <label className="setup-checkbox">
          <input type="checkbox" checked={perms.create_squad}
            onChange={(e) => setPerms(p => ({ ...p, create_squad: e.target.checked }))} />
          Create Squads
        </label>
        <label className="setup-checkbox">
          <input type="checkbox" checked={perms.create_archive}
            onChange={(e) => setPerms(p => ({ ...p, create_archive: e.target.checked }))} />
          Create Archives
        </label>
        <label className="setup-checkbox">
          <input type="checkbox" checked={perms.create_log}
            onChange={(e) => setPerms(p => ({ ...p, create_log: e.target.checked }))} />
          Create Logs
        </label>
        <button className="btn btn-primary stretched-button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Permissions'}
        </button>
      </div>
    </div>
  );
}

// ─── Squad Member Editor Modal ──────────────────────────────

function EditMemberModal({ squadId, member, onUpdated }) {
  const [role, setRole] = useState(member.role);
  const [perms, setPerms] = useState({
    can_read: member.can_read, can_write: member.can_write,
    can_create_log: member.can_create_log, can_create_archive: member.can_create_archive,
    can_manage_members: member.can_manage_members, can_delete_version: member.can_delete_version,
    can_publish: member.can_publish,
  });
  const [saving, setSaving] = useState(false);

  const toggle = (key) => setPerms(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAdminSquadMember(squadId, member.user_id, { role, ...perms });
      destroyModal();
      onUpdated?.();
    } catch (e) {
      toastError(e.body?.message ?? 'Error updating member.');
    }
    setSaving(false);
  };

  const permLabels = [
    ['can_read', 'Read'], ['can_write', 'Write'], ['can_create_log', 'Create Logs'],
    ['can_create_archive', 'Create Archives'], ['can_manage_members', 'Manage Members'],
    ['can_delete_version', 'Delete Versions'], ['can_publish', 'Publish'],
  ];

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Edit Member — {member.name}</h2>
      <div className="modal-form admin-perms-form">
        <label htmlFor="member-role">Role:</label>
        <select id="member-role" value={role} onChange={(e) => setRole(e.target.value)} className="admin-select">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>

        <div className="admin-perms-grid">
          {permLabels.map(([key, label]) => (
            <label key={key} className="setup-checkbox">
              <input type="checkbox" checked={Boolean(perms[key])} onChange={() => toggle(key)} />
              {label}
            </label>
          ))}
        </div>

        <button className="btn btn-primary stretched-button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Workspaces Panel ─────────────────────────────────────

function WorkspacesPanel() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminWorkspaces();
      setWorkspaces(res.workspaces || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (workspace) => {
    showModal(
      <ConfirmDialog
        title={`Delete "${workspace.name}"?`}
        message="This will permanently delete the workspace and all its squads, archives, and logs."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await deleteAdminWorkspace(workspace.id);
          destroyModal();
          load();
        }}
      />
    );
  };

  const filtered = filter
    ? workspaces.filter(w => w.name.toLowerCase().includes(filter.toLowerCase()) || w.owner.toLowerCase().includes(filter.toLowerCase()))
    : workspaces;

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <h3>Workspaces</h3>
        <div className="admin-panel__actions">
          <input type="text" className="admin-filter-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={() => showModal(<NewWorkspaceModal onCreated={load} />, 'modal-md')}>
            + New Workspace
          </button>
        </div>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted">{filter ? 'No matching workspaces.' : 'No workspaces yet.'}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Squads</th>
                <th>Members</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(workspace => (
                <tr key={workspace.id}>
                  <td className="admin-cell--name">{workspace.name}</td>
                  <td>{workspace.owner}</td>
                  <td>{workspace.squad_count}</td>
                  <td>{workspace.member_count}</td>
                  <td>{timeAgo(workspace.created_at)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(workspace)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Users Panel ────────────────────────────────────────────

function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminUsers();
      setUsers(res.users || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (user) => {
    showModal(
      <ConfirmDialog
        title={`Delete user "${user.name}"?`}
        message="This will permanently delete the user and all their sessions, comments, and data."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await deleteAdminUser(user.id);
          destroyModal();
          load();
        }}
      />
    );
  };

  const handleToggleAdmin = async (user) => {
    const newAdmin = !user.is_admin;
    showModal(
      <ConfirmDialog
        title={`${newAdmin ? 'Grant' : 'Revoke'} admin for "${user.name}"?`}
        message={newAdmin ? 'This user will have full platform access.' : 'This user will lose admin privileges.'}
        confirmLabel={newAdmin ? 'Grant Admin' : 'Revoke Admin'}
        danger={!newAdmin}
        onConfirm={async () => {
          await updateAdminUserAdmin(user.id, newAdmin);
          destroyModal();
          load();
        }}
      />
    );
  };

  const filtered = filter
    ? users.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase()))
    : users;

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <h3>Users</h3>
        <div className="admin-panel__actions">
          <input type="text" className="admin-filter-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Squads</th>
                <th>Admin</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td className="admin-cell--user">
                    {u.avatar_url && <img src={u.avatar_url} alt="" className="admin-user-avatar" />}
                    {u.name}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.squad_count}</td>
                  <td>
                    <button
                      className={`admin-badge ${u.is_admin ? 'admin-badge--admin' : 'admin-badge--user'}`}
                      onClick={() => handleToggleAdmin(u)}
                      title={u.is_admin ? 'Click to revoke admin' : 'Click to grant admin'}
                    >
                      {u.is_admin ? 'Admin' : 'User'}
                    </button>
                  </td>
                  <td>{timeAgo(u.created_at)}</td>
                  <td>
                    <div className="admin-cell-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => showModal(<UserPermissionsModal user={u} onUpdated={load} />, 'modal-md')}>
                        Permissions
                      </button>
                      {!u.is_admin && (
                        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(u)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Squads Panel ───────────────────────────────────────────

function SquadsPanel() {
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expandedSquad, setExpandedSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminSquads();
      setSquads(res.squads || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (squad) => {
    if (expandedSquad === squad.id) {
      setExpandedSquad(null);
      setMembers([]);
      return;
    }
    setExpandedSquad(squad.id);
    setMembersLoading(true);
    try {
      const res = await fetchAdminSquadMembers(squad.id);
      setMembers(res.members || []);
    } catch { /* ignore */ }
    setMembersLoading(false);
  };

  const handleRemoveMember = (squadId, member) => {
    showModal(
      <ConfirmDialog
        title={`Remove "${member.name}" from squad?`}
        message="They will lose access to all squad archives."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          await removeAdminSquadMember(squadId, member.user_id);
          destroyModal();
          const res = await fetchAdminSquadMembers(squadId);
          setMembers(res.members || []);
          load();
        }}
      />
    );
  };

  const handleEditMember = (squadId, member) => {
    showModal(
      <EditMemberModal squadId={squadId} member={member} onUpdated={async () => {
        const res = await fetchAdminSquadMembers(squadId);
        setMembers(res.members || []);
      }} />,
      'modal-md'
    );
  };

  const filtered = filter
    ? squads.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || (s.workspace_name || '').toLowerCase().includes(filter.toLowerCase()))
    : squads;

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <h3>Squads</h3>
        <div className="admin-panel__actions">
          <input type="text" className="admin-filter-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted">{filter ? 'No matching squads.' : 'No squads yet.'}</p>
      ) : (
        <div className="admin-squads-list">
          {filtered.map(squad => (
            <div key={squad.id} className={`admin-squad-card ${expandedSquad === squad.id ? 'admin-squad-card--expanded' : ''}`}>
              <div className="admin-squad-card__header" onClick={() => toggleExpand(squad)}>
                <div className="admin-squad-card__info">
                  <span className="admin-squad-card__name">{squad.name}</span>
                  <span className="admin-squad-card__meta">
                    {squad.workspace_name || 'No workspace'} · {squad.member_count} member{squad.member_count !== 1 ? 's' : ''} · {squad.archive_count} archive{squad.archive_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <span className="admin-squad-card__toggle">{expandedSquad === squad.id ? '▾' : '▸'}</span>
              </div>

              {expandedSquad === squad.id && (
                <div className="admin-squad-card__members">
                  {membersLoading ? (
                    <p className="text-muted">Loading members…</p>
                  ) : members.length === 0 ? (
                    <p className="text-muted">No members.</p>
                  ) : (
                    <table className="admin-table admin-table--compact">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Read</th>
                          <th>Write</th>
                          <th>Logs</th>
                          <th>Archives</th>
                          <th>Members</th>
                          <th>Versions</th>
                          <th>Publish</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(m => (
                          <tr key={m.user_id}>
                            <td className="admin-cell--user">
                              {m.avatar_url && <img src={m.avatar_url} alt="" className="admin-user-avatar" />}
                              {m.name}
                            </td>
                            <td>
                              <span className={`admin-role-badge admin-role-badge--${m.role}`}>{m.role}</span>
                            </td>
                            <td>{m.can_read ? '✓' : '—'}</td>
                            <td>{m.can_write ? '✓' : '—'}</td>
                            <td>{m.can_create_log ? '✓' : '—'}</td>
                            <td>{m.can_create_archive ? '✓' : '—'}</td>
                            <td>{m.can_manage_members ? '✓' : '—'}</td>
                            <td>{m.can_delete_version ? '✓' : '—'}</td>
                            <td>{m.can_publish ? '✓' : '—'}</td>
                            <td>
                              <div className="admin-cell-actions">
                                <button className="btn btn-ghost btn-sm" onClick={() => handleEditMember(squad.id, m)}>Edit</button>
                                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleRemoveMember(squad.id, m)}>Remove</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Invitations Panel ──────────────────────────────────────

function InvitationsPanel() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminInvitations();
      setInvitations(res.invitations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = async (inv) => {
    try {
      await deleteAdminInvitation(inv.id);
      load();
    } catch (e) {
      toastError(e.body?.message ?? 'Error revoking invitation.');
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <h3>User Invitations</h3>
        <button className="btn btn-primary btn-sm" onClick={() => showModal(<InviteUserModal onInvited={load} />, 'modal-md')}>
          + Invite User
        </button>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : invitations.length === 0 ? (
        <p className="text-muted">No invitations sent yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Invited By</th>
                <th>Sent</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => {
                const expired = new Date(inv.expires_at) <= new Date();
                const status = inv.accepted ? 'Accepted' : expired ? 'Expired' : 'Pending';
                return (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>
                      <span className={`status-badge status-badge--${status.toLowerCase()}`}>{status}</span>
                    </td>
                    <td>{inv.invited_by_name}</td>
                    <td>{timeAgo(inv.created_at)}</td>
                    <td>{timeAgo(inv.expires_at)}</td>
                    <td>
                      {!inv.accepted && !expired && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRevoke(inv)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Admin Dashboard ────────────────────────────────────────

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'users', label: 'Users', icon: '👤' },
  { key: 'workspaces', label: 'Workspaces', icon: '🏢' },
  { key: 'squads', label: 'Squads', icon: '👥' },
  { key: 'invitations', label: 'Invitations', icon: '✉' },
];

export default function AdminPage() {
  const [activePanel, setActivePanel] = useState('overview');
  const [authorized, setAuthorized] = useState(null);

  useEffect(() => {
    fetchAdminStatus()
      .then(res => setAuthorized(res.isAdmin === true))
      .catch(() => setAuthorized(false));
  }, []);

  if (authorized === null) {
    return <StdLayout><div className="admin-dashboard"><p className="text-muted">Loading…</p></div></StdLayout>;
  }
  if (!authorized) {
    return <StdLayout><div className="admin-dashboard"><h1>Access Denied</h1><p>You do not have admin privileges.</p></div></StdLayout>;
  }

  return (
    <StdLayout>
      <div className="admin-dashboard">
        <aside className="admin-sidebar">
          <div className="admin-sidebar__title">Admin Console</div>
          <nav className="admin-sidebar__nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.key}
                className={`admin-sidebar__item ${activePanel === item.key ? 'active' : ''}`}
                onClick={() => setActivePanel(item.key)}
              >
                <span className="admin-sidebar__icon">{item.icon}</span>
                <span className="admin-sidebar__label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="admin-main">
          {activePanel === 'overview' && <OverviewPanel />}
          {activePanel === 'users' && <UsersPanel />}
          {activePanel === 'workspaces' && <WorkspacesPanel />}
          {activePanel === 'squads' && <SquadsPanel />}
          {activePanel === 'invitations' && <InvitationsPanel />}
        </main>
      </div>
    </StdLayout>
  );
}
