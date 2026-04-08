/**
 * Cloud Codex - Organizations Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  fetchTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  fetchTeamMembers,
  inviteTeamMember,
  updateTeamMember,
  removeTeamMember,
  fetchTeamInvitations,
  cancelInvitation,
  searchUsers,
  showModal,
  destroyModal,
  fetchAdminStatus,
} from '../util';
import ConfirmDialog from '../components/ConfirmDialog';
import { toastError } from '../components/Toast';

function NewOrgModal({ onCreated }) {
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [addTeam, setAddTeam] = useState(false);
  const [addProject, setAddProject] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Organization name is required.'); return; }
    try {
      await createOrganization(name, {
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
        <label htmlFor="org-name">Organization Name:</label>
        <input
          id="org-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />

        <label className="setup-checkbox">
          <input type="checkbox" checked={addTeam} onChange={(e) => {
            setAddTeam(e.target.checked);
            if (!e.target.checked) setAddProject(false);
          }} />
          Also create a team
        </label>
        {addTeam && (
          <>
            <input
              type="text" value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Engineering"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <label className="setup-checkbox">
              <input type="checkbox" checked={addProject} onChange={(e) => setAddProject(e.target.checked)} />
              Also create a project
            </label>
            {addProject && (
              <input
                type="text" value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Documentation"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            )}
          </>
        )}

        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function RenameOrgModal({ org, onRenamed }) {
  const [name, setName] = useState(org.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    try {
      await updateOrganization(org.id, name);
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming organization.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Organization</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-org">Name:</label>
        <input
          id="rename-org" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

function NewTeamModal({ orgId, onCreated }) {
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [addProject, setAddProject] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required.'); return; }
    try {
      await createTeam(orgId, name, {
        projectName: addProject ? projectName.trim() || undefined : undefined,
      });
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating team.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Team</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="team-name">Team Name:</label>
        <input id="team-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <label className="setup-checkbox">
          <input type="checkbox" checked={addProject} onChange={(e) => setAddProject(e.target.checked)} />
          Also create a project
        </label>
        {addProject && (
          <input
            type="text" value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Documentation"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        )}
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function RenameTeamModal({ team, onRenamed }) {
  const [name, setName] = useState(team.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    try {
      await updateTeam(team.id, name);
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming team.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Team</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-team">Name:</label>
        <input id="rename-team" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

// --- Invite Member Modal ---

function InviteMemberModal({ teamId, onInvited }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('member');
  const [perms, setPerms] = useState({ can_read: true, can_write: false, can_create_page: false, can_create_project: false, can_manage_members: false, can_delete_version: false });
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async (q) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchUsers(q);
      setResults(res.users || []);
    } catch { setResults([]); }
    setSearching(false);
  }, []);

  const handleInvite = async () => {
    setError(null);
    if (!selected) { setError('Please select a user.'); return; }
    try {
      await inviteTeamMember(teamId, { userId: selected.id, role, ...perms });
      destroyModal();
      onInvited?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error sending invitation.');
    }
  };

  const togglePerm = (key) => setPerms(p => ({ ...p, [key]: !p[key] }));

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Invite Member</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label>Search Users:</label>
        <div className="user-search">
          <input
            className="user-search__input"
            type="text" value={query} placeholder="Search by name or email..."
            onChange={(e) => handleSearch(e.target.value)}
          />
          {searching && <p className="text-muted text-sm">Searching...</p>}
          {results.length > 0 && !selected && (
            <ul className="user-search__results">
              {results.map(u => (
                <li key={u.id} className="user-search__result" onClick={() => { setSelected(u); setResults([]); setQuery(u.email); }}>
                  <span>{u.name}</span> <span className="text-muted">{u.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected && (
          <div className="invite-selected">
            <span>Selected: <strong>{selected.name}</strong> ({selected.email})</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setQuery(''); }}>Change</button>
          </div>
        )}

        <label style={{ marginTop: 12 }}>Role:</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: '6px 10px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>

        <label style={{ marginTop: 12 }}>Permissions:</label>
        <div className="invite-perms-grid">
          {[
            ['can_read', 'Read', 'View projects and pages'],
            ['can_write', 'Write', 'Edit pages and documents'],
            ['can_create_page', 'Create Pages', 'Create new pages in projects'],
            ['can_create_project', 'Create Projects', 'Create new projects in the team'],
            ['can_manage_members', 'Manage Members', 'Invite/remove team members'],
            ['can_delete_version', 'Delete Versions', 'Delete version history entries'],
          ].map(([key, label, desc]) => (
            <label key={key} className="invite-perm-toggle">
              <input type="checkbox" checked={perms[key]} onChange={() => togglePerm(key)} />
              <div>
                <strong>{label}</strong>
                <p className="text-muted text-sm">{desc}</p>
              </div>
            </label>
          ))}
        </div>

        <button className="btn btn-primary stretched-button" style={{ marginTop: 16 }} onClick={handleInvite}>Send Invitation</button>
      </div>
    </div>
  );
}

// --- Team Members Panel (inline in team row) ---

const PERM_LABELS = {
  can_read: 'Read',
  can_write: 'Write',
  can_create_page: 'Create Pages',
  can_create_project: 'Create Projects',
  can_manage_members: 'Manage Members',
  can_delete_version: 'Delete Versions',
};

function TeamMembersPanel({ teamId }) {
  const [members, setMembers] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([
        fetchTeamMembers(teamId),
        fetchTeamInvitations(teamId),
      ]);
      setMembers(mRes.members || []);
      setPending(iRes.invitations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const handleTogglePerm = async (member, key) => {
    try {
      await updateTeamMember(teamId, member.user_id, { [key]: !member[key] });
      setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, [key]: !m[key] } : m));
    } catch (e) { toastError(e); }
  };

  const handleRoleChange = async (member, newRole) => {
    try {
      await updateTeamMember(teamId, member.user_id, { role: newRole });
      setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role: newRole } : m));
    } catch (e) { toastError(e); }
  };

  const handleRemove = (member) => {
    showModal(
      <ConfirmDialog
        title="Remove Member"
        message={`Remove ${member.name} from this team?`}
        onConfirm={async () => {
          await removeTeamMember(teamId, member.user_id);
          destroyModal();
          load();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  const handleCancelInvitation = async (inv) => {
    try {
      await cancelInvitation(inv.id);
      load();
    } catch (e) { toastError(e); }
  };

  if (loading) return <p className="text-muted text-sm" style={{ padding: '4px 0' }}>Loading members...</p>;

  return (
    <div className="team-members-panel">
      <div className="team-members-panel__header">
        <span className="text-muted text-sm">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => showModal(<InviteMemberModal teamId={teamId} onInvited={load} />, 'modal-lg')}
        >
          + Invite
        </button>
      </div>

      {members.length === 0 && pending.length === 0 && (
        <p className="text-muted text-sm">No members yet. Invite someone to get started.</p>
      )}

      {members.map(member => (
        <div key={member.user_id} className="member-row">
          <div className="member-row__info">
            <strong>{member.name}</strong>
            <span className="text-muted text-sm">{member.email}</span>
          </div>
          <div className="member-row__role">
            {member.role === 'owner' ? (
              <span className="role-badge role-badge--owner">Owner</span>
            ) : (
              <select
                value={member.role}
                onChange={(e) => handleRoleChange(member, e.target.value)}
                className="role-select"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            )}
          </div>
          <div className="member-row__perms">
            {Object.entries(PERM_LABELS).map(([key, label]) => (
              <label key={key} className="perm-chip" title={label}>
                <input
                  type="checkbox"
                  checked={Boolean(member[key])}
                  disabled={member.role === 'owner'}
                  onChange={() => handleTogglePerm(member, key)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {member.role !== 'owner' && (
            <button className="btn btn-danger btn-sm" onClick={() => handleRemove(member)}>Remove</button>
          )}
        </div>
      ))}

      {pending.length > 0 && (
        <div className="pending-invitations">
          <h5 className="text-muted" style={{ margin: '12px 0 4px' }}>Pending Invitations</h5>
          {pending.map(inv => (
            <div key={inv.id} className="member-row member-row--pending">
              <div className="member-row__info">
                <strong>{inv.name}</strong>
                <span className="text-muted text-sm">{inv.email}</span>
              </div>
              <span className="text-muted text-sm">Invited by {inv.invited_by_name}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => handleCancelInvitation(inv)}>Cancel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Inline Teams for an Organization ---

function OrgTeams({ orgId }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTeams(orgId);
      setTeams(res.teams || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const handleDeleteTeam = (team) => {
    showModal(
      <ConfirmDialog
        title="Delete Team"
        message={`Are you sure you want to delete "${team.name}"? All projects in this team will lose their team association.`}
        onConfirm={async () => {
          await deleteTeam(team.id);
          destroyModal();
          loadTeams();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <div className="org-teams">
      <div className="org-teams__header">
        <h4>Teams</h4>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => showModal(<NewTeamModal orgId={orgId} onCreated={loadTeams} />, 'modal-md')}
        >
          + New Team
        </button>
      </div>
      {loading && <p className="text-muted text-sm">Loading teams...</p>}
      {!loading && teams.length === 0 && (
        <p className="text-muted text-sm">No teams yet.</p>
      )}
      {!loading && teams.length > 0 && (
        <ul className="settings-item-list compact">
          {teams.map(team => (
            <li key={team.id} className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpandedTeam(prev => prev === team.id ? null : team.id)}>
                  <span style={{ fontSize: '0.8em', marginRight: 6 }}>{expandedTeam === team.id ? '▾' : '▸'}</span>
                  <span>{team.name}</span>
                  <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                    Created: {new Date(team.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="card__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/projects?team=${team.id}`)}
                  >
                    Projects
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => showModal(<RenameTeamModal team={team} onRenamed={loadTeams} />, 'modal-md')}
                  >
                    Rename
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTeam(team)}>Delete</button>
                </div>
              </div>
              {expandedTeam === team.id && (
                <TeamMembersPanel teamId={team.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OrganizationsPage() {
  const { orgId } = useParams();
  const [orgs, setOrgs] = useState([]);
  const [expandedOrg, setExpandedOrg] = useState(orgId ? Number(orgId) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, adminRes] = await Promise.all([
        fetchOrganizations(),
        fetchAdminStatus().catch(() => ({ isAdmin: false })),
      ]);
      setOrgs(orgRes.organizations || []);
      setIsAdmin(adminRes.isAdmin === true);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading organizations.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (orgId) setExpandedOrg(Number(orgId));
  }, [orgId]);

  const handleDelete = (org) => {
    showModal(
      <ConfirmDialog
        title="Delete Organization"
        message={`Are you sure you want to delete "${org.name}"? This will delete all teams, projects, and pages within it.`}
        onConfirm={async () => {
          await deleteOrganization(org.id);
          destroyModal();
          if (expandedOrg === org.id) setExpandedOrg(null);
          load();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  const toggleOrg = (orgId) => {
    setExpandedOrg(prev => prev === orgId ? null : orgId);
  };

  return (
    <StdLayout>
      <div className="page-header">
        <h1>Organizations</h1>
        {isAdmin && (
          <button
            className="btn btn-primary"
            onClick={() => showModal(<NewOrgModal onCreated={load} />, 'modal-md')}
          >
            + New Organization
          </button>
        )}
      </div>

      {loading && <p className="text-muted">Loading organizations...</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && orgs.length === 0 && (
        <div className="empty-state">
          <p>No organizations yet. Create one to get started.</p>
        </div>
      )}

      <div className="org-list">
        {orgs.map(org => (
          <div key={org.id} className={`card ${expandedOrg === org.id ? 'card--expanded' : ''}`}>
            <div className="card__body" onClick={() => toggleOrg(org.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8em' }}>{expandedOrg === org.id ? '▾' : '▸'}</span>
                <h3 className="card__title" style={{ margin: 0 }}>{org.name}</h3>
              </div>
              <p className="card__meta">Owner: {org.owner} &middot; Created: {new Date(org.created_at).toLocaleDateString()}</p>
            </div>
            <div className="card__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(<RenameOrgModal org={org} onRenamed={load} />, 'modal-md')}
              >
                Rename
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(org)}>
                Delete
              </button>
            </div>
            {expandedOrg === org.id && (
              <div className="card__expanded-content" style={{ padding: '0 16px 16px' }}>
                <OrgTeams orgId={org.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </StdLayout>
  );
}
