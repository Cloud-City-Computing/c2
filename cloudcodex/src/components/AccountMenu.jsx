/**
 * Cloud Codex - Settings Menu & Panels
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSessStorage, apiFetch, getSessionTokenFromCookie,
  fetchProjects, updateProject, deleteProject, manageProjectAccess,
  fetchOrganizations, fetchTeams, fetchPermissions, updatePermissions,
  fetchTeamPermissions, updateTeamPermissions,
  fetchUserPermissions, searchUsers,
} from '../util';

// ===========================
//  User Search Input (reusable)
// ===========================

function UserSearchInput({ onSelect, placeholder = 'Search users by name or email...' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await searchUsers(query.trim());
        setResults(res.users || []);
        setOpen(true);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (user) => {
    onSelect(user);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="user-search">
      <input
        type="text"
        className="user-search__input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && results.length > 0 && (
        <ul className="user-search__results">
          {results.map(u => (
            <li key={u.id} className="user-search__item" onMouseDown={() => handleSelect(u)}>
              <span className="user-search__name">{u.name}</span>
              <span className="user-search__email">{u.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================
//  Account Panels (used by AccountSettings page)
// ===========================

export function AccountInfoUpdatePanel() {
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      const userId = getSessStorage('currentUser')?.id;
      if (!userId) { setStatus({ type: 'error', message: 'Not authenticated.' }); return; }
      try {
        const res = await apiFetch('POST', '/api/get-user', { userId, token: getSessionTokenFromCookie() });
        if (res.success) {
          setFields(f => ({ ...f, name: res.user.name ?? '', email: res.user.email ?? '' }));
        }
      } catch (e) {
        setStatus({ type: 'error', message: `Error fetching user data: ${e.body?.message ?? e.message}` });
      }
    };
    loadUser();
  }, []);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (fields.password && fields.password !== fields.confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    const userId = getSessStorage('currentUser')?.id;
    if (!userId) { setStatus({ type: 'error', message: 'Not authenticated.' }); return; }

    const payload = { userId, name: fields.name, email: fields.email };
    if (fields.password) payload.password = fields.password;

    try {
      await apiFetch('POST', '/api/update-account', payload);
      setStatus({ type: 'success', message: 'Account updated successfully.' });
    } catch (e) {
      setStatus({ type: 'error', message: `Error updating account: ${e.body?.message ?? e.message}` });
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Update Account Information</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}
      <form className="account-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" value={fields.name} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={fields.email} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="password">New Password</label>
          <input id="password" name="password" type="password" value={fields.password} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm New Password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" value={fields.confirmPassword} onChange={handleChange} />
        </div>
        <button type="submit" className="btn btn-primary stretched-button">Update Info</button>
      </form>
    </div>
  );
}

export function AccountPreferencesPanel() {
  return (
    <div className="settings-panel">
      <h2 className="panel-title">Account Preferences</h2>
      <form className="account-form">
        <div className="checkbox-group">
          <label><input type="checkbox" name="newsletter" /> Receive Newsletter</label>
        </div>
        <div className="checkbox-group">
          <label><input type="checkbox" name="2fa" /> Enable Two-Factor Authentication</label>
        </div>
        <button type="submit" className="btn btn-primary stretched-button">Update Preferences</button>
      </form>
    </div>
  );
}

// ===========================
//  Project Settings Panel
// ===========================

function ProjectSettingsPanel() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [accessUser, setAccessUser] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProjects();
      setProjects(res.projects || []);
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Failed to load projects.' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleSelect = (project) => {
    setSelected(project);
    setRenameValue(project.name);
    setStatus(null);
  };

  const handleRename = async () => {
    if (!renameValue.trim() || !selected) return;
    try {
      await updateProject(selected.id, renameValue.trim());
      setStatus({ type: 'success', message: 'Project renamed.' });
      loadProjects();
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error renaming project.' });
    }
  };

  const handleAccess = async (accessType, action) => {
    if (!accessUser) {
      setStatus({ type: 'error', message: 'Search and select a user first.' });
      return;
    }
    try {
      await manageProjectAccess(selected.id, accessUser.id, accessType, action);
      setStatus({ type: 'success', message: `${action === 'add' ? 'Added' : 'Removed'} ${accessType} access for ${accessUser.name}.` });
      setAccessUser(null);
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error updating access.' });
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await deleteProject(selected.id);
      setSelected(null);
      setStatus({ type: 'success', message: 'Project deleted.' });
      loadProjects();
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error deleting project.' });
    }
  };

  if (loading) return <p className="text-muted">Loading projects...</p>;

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Project Settings</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}

      <div className="settings-split">
        <ul className="settings-item-list">
          {projects.length === 0
            ? <li className="text-muted">No projects found.</li>
            : projects.map(p => (
              <li key={p.id}
                className={`settings-item ${selected?.id === p.id ? 'active' : ''}`}
                onClick={() => handleSelect(p)}>
                <span>{p.name}</span>
                {p.team_name && <span className="text-muted text-sm">{p.team_name}</span>}
              </li>
            ))
          }
        </ul>

        {selected && (
          <div className="settings-detail">
            <h3>{selected.name}</h3>
            <p className="text-muted text-sm">
              Created by {selected.created_by} on {new Date(selected.created_at).toLocaleDateString()}
            </p>

            <div className="settings-section">
              <h4>Rename Project</h4>
              <div className="inline-form">
                <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={handleRename}>Rename</button>
              </div>
            </div>

            <div className="settings-section">
              <h4>Manage Access</h4>
              <UserSearchInput onSelect={setAccessUser} placeholder="Search for a user..." />
              {accessUser && (
                <div className="access-selected-user">
                  <span className="text-sm">Selected: <strong>{accessUser.name}</strong> ({accessUser.email})</span>
                  <div className="inline-form" style={{ marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => handleAccess('read', 'add')}>+ Read</button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleAccess('write', 'add')}>+ Write</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleAccess('read', 'remove')}>- Read</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleAccess('write', 'remove')}>- Write</button>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-section settings-danger-zone">
              <h4>Danger Zone</h4>
              <button className="btn btn-danger" onClick={handleDelete}>Delete Project</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================
//  Organization Overview Panel
// ===========================

function OrganizationOverviewPanel() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchOrganizations();
        setOrgs(res.organizations || []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Organizations</h2>
      <p className="text-muted">Manage your organizations and their teams.</p>
      {loading ? <p className="text-muted">Loading...</p> : (
        <ul className="settings-item-list compact">
          {orgs.length === 0
            ? <li className="text-muted">No organizations yet.</li>
            : orgs.map(org => (
              <li key={org.id} className="settings-item clickable"
                onClick={() => navigate(`/organizations`)}>
                <span>{org.name}</span>
                <span className="text-muted text-sm">Owner: {org.owner}</span>
              </li>
            ))
          }
        </ul>
      )}
      <button className="btn btn-primary" style={{ marginTop: 12 }}
        onClick={() => navigate('/organizations')}>
        Manage Organizations
      </button>
    </div>
  );
}

// ===========================
//  Team Overview Panel
// ===========================

function TeamOverviewPanel() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchOrganizations();
        setOrgs(res.organizations || []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrg) { setTeams([]); return; }
    (async () => {
      try {
        const res = await fetchTeams(selectedOrg.id);
        setTeams(res.teams || []);
      } catch { setTeams([]); }
    })();
  }, [selectedOrg]);

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Teams</h2>
      <p className="text-muted">View teams across your organizations.</p>
      {loading ? <p className="text-muted">Loading...</p> : (
        <>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label htmlFor="org-select">Organization</label>
            <select id="org-select" className="form-select"
              value={selectedOrg?.id ?? ''}
              onChange={(e) => setSelectedOrg(orgs.find(o => o.id === Number(e.target.value)) ?? null)}>
              <option value="">Select an organization</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {selectedOrg && (
            <ul className="settings-item-list compact">
              {teams.length === 0
                ? <li className="text-muted">No teams in this organization.</li>
                : teams.map(t => (
                  <li key={t.id} className="settings-item">
                    <span>{t.name}</span>
                  </li>
                ))
              }
            </ul>
          )}
          {selectedOrg && (
            <button className="btn btn-primary" style={{ marginTop: 12 }}
              onClick={() => navigate(`/organizations/${selectedOrg.id}/teams`)}>
              Manage Teams
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ===========================
//  Permissions Panel
// ===========================

function PermissionToggles({ perms, fields, onToggle }) {
  const labels = {
    create_team:    { title: 'Create Teams',    desc: 'Create teams within organizations' },
    create_project: { title: 'Create Projects', desc: 'Create new projects' },
    create_page:    { title: 'Create Pages',    desc: 'Create pages within projects' },
  };

  return (
    <div className="permissions-grid">
      {fields.map(key => (
        <label key={key} className="permission-toggle">
          <input type="checkbox" checked={!!perms[key]} onChange={() => onToggle(key)} />
          <div>
            <strong>{labels[key].title}</strong>
            <p className="text-muted text-sm">{labels[key].desc}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

function PermissionsPanel() {
  // --- My Permissions ---
  const [myPerms, setMyPerms] = useState({ create_team: false, create_project: false, create_page: true });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchPermissions();
        if (res.permissions) setMyPerms(res.permissions);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleMyToggle = async (key) => {
    const prev = { ...myPerms };
    const updated = { ...myPerms, [key]: !myPerms[key] };
    setMyPerms(updated);
    setStatus(null);
    const userId = getSessStorage('currentUser')?.id;
    if (!userId) return;
    try {
      await updatePermissions(userId, updated);
      setStatus({ type: 'success', message: 'Your permissions updated.' });
    } catch (e) {
      setMyPerms(prev);
      setStatus({ type: 'error', message: e.body?.message ?? 'Error updating permissions.' });
    }
  };

  // --- Team Permissions ---
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamPerms, setTeamPerms] = useState({ create_project: false, create_page: true });
  const [teamStatus, setTeamStatus] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchOrganizations();
        setOrgs(res.organizations || []);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    setSelectedTeam(null);
    setTeams([]);
    if (!selectedOrg) return;
    (async () => {
      try {
        const res = await fetchTeams(selectedOrg.id);
        setTeams(res.teams || []);
      } catch { setTeams([]); }
    })();
  }, [selectedOrg]);

  useEffect(() => {
    if (!selectedTeam) return;
    (async () => {
      try {
        const res = await fetchTeamPermissions(selectedTeam.id);
        setTeamPerms(res.permissions || { create_project: false, create_page: true });
      } catch { setTeamPerms({ create_project: false, create_page: true }); }
    })();
  }, [selectedTeam]);

  const handleTeamToggle = async (key) => {
    const prev = { ...teamPerms };
    const updated = { ...teamPerms, [key]: !teamPerms[key] };
    setTeamPerms(updated);
    setTeamStatus(null);
    try {
      await updateTeamPermissions(selectedTeam.id, updated);
      setTeamStatus({ type: 'success', message: `Permissions updated for team "${selectedTeam.name}".` });
    } catch (e) {
      setTeamPerms(prev);
      setTeamStatus({ type: 'error', message: e.body?.message ?? 'Error updating team permissions.' });
    }
  };

  // --- User Permissions (for org owners) ---
  const [targetUser, setTargetUser] = useState(null);
  const [userPerms, setUserPerms] = useState({ create_team: false, create_project: false, create_page: true });
  const [userStatus, setUserStatus] = useState(null);

  useEffect(() => {
    if (!targetUser) return;
    (async () => {
      try {
        const res = await fetchUserPermissions(targetUser.id);
        setUserPerms(res.permissions || { create_team: false, create_project: false, create_page: true });
      } catch {
        setUserPerms({ create_team: false, create_project: false, create_page: true });
      }
    })();
  }, [targetUser]);

  const handleUserToggle = async (key) => {
    if (!targetUser) return;
    const prev = { ...userPerms };
    const updated = { ...userPerms, [key]: !userPerms[key] };
    setUserPerms(updated);
    setUserStatus(null);
    try {
      await updatePermissions(targetUser.id, updated);
      setUserStatus({ type: 'success', message: `Permissions updated for ${targetUser.name}.` });
    } catch (e) {
      setUserPerms(prev);
      setUserStatus({ type: 'error', message: e.body?.message ?? 'Error updating user permissions.' });
    }
  };

  if (loading) return <p className="text-muted">Loading...</p>;

  const currentUser = getSessStorage('currentUser');
  const isOrgOwner = orgs.some(o => o.owner === currentUser?.email);

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Permissions</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}

      {/* --- My Permissions --- */}
      <div className="permissions-section">
        <h3>My Permissions</h3>
        <p className="text-muted text-sm">Controls what you can do across the application.</p>
        <PermissionToggles perms={myPerms} fields={['create_team', 'create_project', 'create_page']} onToggle={handleMyToggle} />
      </div>

      {/* --- Team Permissions (org owners) --- */}
      {isOrgOwner && (
        <div className="permissions-section">
          <h3>Team Permissions</h3>
          <p className="text-muted text-sm">Set what teams in your organizations can do.</p>
          {teamStatus && <p className={`panel-status ${teamStatus.type}`}>{teamStatus.message}</p>}

          <div className="inline-form" style={{ marginBottom: 12 }}>
            <select className="form-select" style={{ flex: 1 }}
              value={selectedOrg?.id ?? ''}
              onChange={(e) => setSelectedOrg(orgs.find(o => o.id === Number(e.target.value)) ?? null)}>
              <option value="">Select organization</option>
              {orgs.filter(o => o.owner === currentUser?.email).map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select className="form-select" style={{ flex: 1 }}
              value={selectedTeam?.id ?? ''}
              onChange={(e) => setSelectedTeam(teams.find(t => t.id === Number(e.target.value)) ?? null)}
              disabled={!selectedOrg}>
              <option value="">Select team</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {selectedTeam && (
            <PermissionToggles perms={teamPerms} fields={['create_project', 'create_page']} onToggle={handleTeamToggle} />
          )}
        </div>
      )}

      {/* --- User Permissions (org owners) --- */}
      {isOrgOwner && (
        <div className="permissions-section">
          <h3>User Permissions</h3>
          <p className="text-muted text-sm">Manage permissions for individual users in your organizations.</p>
          {userStatus && <p className={`panel-status ${userStatus.type}`}>{userStatus.message}</p>}

          <UserSearchInput onSelect={(u) => { setTargetUser(u); setUserStatus(null); }} placeholder="Search for a user..." />

          {targetUser && (
            <div style={{ marginTop: 12 }}>
              <p className="text-sm">Managing: <strong>{targetUser.name}</strong> ({targetUser.email})</p>
              <PermissionToggles perms={userPerms} fields={['create_team', 'create_project', 'create_page']} onToggle={handleUserToggle} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================
//  Settings Menu
// ===========================

const PANELS = [
  { label: 'Project Settings',  Panel: ProjectSettingsPanel    },
  { label: 'Organizations',     Panel: OrganizationOverviewPanel },
  { label: 'Teams',             Panel: TeamOverviewPanel        },
  { label: 'Permissions',       Panel: PermissionsPanel         },
];

export default function SettingsMenu({ onPanelChange }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const Initial = PANELS[0].Panel;
    onPanelChange(<Initial />);
  }, []);

  return (
    <div className="settings-menu">
      <h3>Settings</h3>
      <ul>
        {PANELS.map(({ label, Panel }, i) => (
          <li key={label} className={active === i ? 'active' : ''}>
            <button className="btn btn-ghost" onClick={() => { setActive(i); onPanelChange(<Panel />); }}>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}