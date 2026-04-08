/**
 * Cloud Codex - Admin Console Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchAdminStatus,
  fetchAdminStats,
  fetchAdminOrganizations,
  createAdminOrganization,
  deleteAdminOrganization,
  fetchAdminUsers,
  deleteAdminUser,
  fetchAdminInvitations,
  createAdminInvitation,
  deleteAdminInvitation,
  showModal,
  destroyModal,
} from '../util';
import ConfirmDialog from '../components/ConfirmDialog';
import { toastError } from '../components/Toast';

// ─── Stats Overview ─────────────────────────────────────────

function StatsOverview() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchAdminStats().then(res => setStats(res.stats)).catch(() => {});
  }, []);

  if (!stats) return null;

  const items = [
    { label: 'Users', value: stats.userCount },
    { label: 'Organizations', value: stats.orgCount },
    { label: 'Teams', value: stats.teamCount },
    { label: 'Projects', value: stats.projectCount },
    { label: 'Pages', value: stats.pageCount },
    { label: 'Pending Invites', value: stats.pendingInviteCount },
  ];

  return (
    <div className="admin-stats">
      {items.map(item => (
        <div key={item.label} className="admin-stat-card">
          <span className="admin-stat-card__value">{item.value}</span>
          <span className="admin-stat-card__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── New Org Modal ──────────────────────────────────────────

function NewOrgModal({ onCreated }) {
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [teamName, setTeamName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [addTeam, setAddTeam] = useState(false);
  const [addProject, setAddProject] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Organization name is required.'); return; }
    if (!ownerEmail.trim()) { setError('Owner email is required.'); return; }
    try {
      await createAdminOrganization(name, ownerEmail, {
        teamName: addTeam ? teamName.trim() || undefined : undefined,
        projectName: addTeam && addProject ? projectName.trim() || undefined : undefined,
      });
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating organization.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Organization</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="admin-org-name">Organization Name:</label>
        <input id="admin-org-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />

        <label htmlFor="admin-org-owner">Owner Email:</label>
        <input id="admin-org-owner" type="email" value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="user@example.com" />

        <label className="setup-checkbox">
          <input type="checkbox" checked={addTeam} onChange={(e) => {
            setAddTeam(e.target.checked);
            if (!e.target.checked) setAddProject(false);
          }} />
          Also create a team
        </label>
        {addTeam && (
          <>
            <input type="text" value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Engineering"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            <label className="setup-checkbox">
              <input type="checkbox" checked={addProject} onChange={(e) => setAddProject(e.target.checked)} />
              Also create a project
            </label>
            {addProject && (
              <input type="text" value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
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

// ─── Invite User Modal ──────────────────────────────────────

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

// ─── Organizations Section ──────────────────────────────────

function OrganizationsSection() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminOrganizations();
      setOrgs(res.organizations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (org) => {
    showModal(
      <ConfirmDialog
        title={`Delete "${org.name}"?`}
        message="This will permanently delete the organization and all its teams, projects, and pages."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await deleteAdminOrganization(org.id);
            load();
          } catch (e) {
            toastError(e.body?.message ?? 'Error deleting organization.');
          }
        }}
      />
    );
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h2>Organizations</h2>
        <button className="btn btn-primary btn-sm" onClick={() => showModal(<NewOrgModal onCreated={load} />, 'modal-md')}>
          + New Organization
        </button>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : orgs.length === 0 ? (
        <p className="text-muted">No organizations yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Teams</th>
                <th>Members</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.owner}</td>
                  <td>{org.team_count}</td>
                  <td>{org.member_count}</td>
                  <td>{new Date(org.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(org)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Users Section ──────────────────────────────────────────

function UsersSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

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
          try {
            await deleteAdminUser(user.id);
            load();
          } catch (e) {
            toastError(e.body?.message ?? 'Error deleting user.');
          }
        }}
      />
    );
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h2>Users</h2>
      </div>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Teams</th>
                <th>Admin</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    {u.avatar_url && <img src={u.avatar_url} alt="" className="admin-user-avatar" />}
                    {u.name}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.team_count}</td>
                  <td>{u.is_admin ? '✓' : ''}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    {!u.is_admin && (
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(u)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Invitations Section ────────────────────────────────────

function InvitationsSection() {
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
    <section className="admin-section">
      <div className="admin-section__header">
        <h2>User Invitations</h2>
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
                <th></th>
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
                    <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
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
    </section>
  );
}

// ─── Admin Console Page ─────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [authorized, setAuthorized] = useState(null); // null = loading, true/false

  useEffect(() => {
    fetchAdminStatus()
      .then(res => setAuthorized(res.isAdmin === true))
      .catch(() => setAuthorized(false));
  }, []);

  if (authorized === null) {
    return <StdLayout><div className="admin-page"><p className="text-muted">Loading…</p></div></StdLayout>;
  }
  if (!authorized) {
    return <StdLayout><div className="admin-page"><h1>Access Denied</h1><p>You do not have admin privileges.</p></div></StdLayout>;
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'organizations', label: 'Organizations' },
    { key: 'users', label: 'Users' },
    { key: 'invitations', label: 'Invitations' },
  ];

  return (
    <StdLayout>
      <div className="admin-page">
        <div className="admin-page__header">
          <h1>Admin Console</h1>
        </div>

        <div className="admin-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`admin-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="admin-page__body">
          {activeTab === 'overview' && <StatsOverview />}
          {activeTab === 'organizations' && <OrganizationsSection />}
          {activeTab === 'users' && <UsersSection />}
          {activeTab === 'invitations' && <InvitationsSection />}
        </div>
      </div>
    </StdLayout>
  );
}
