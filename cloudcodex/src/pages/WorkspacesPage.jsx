/**
 * Cloud Codex - Workspaces Log
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  fetchSquads,
  createSquad,
  updateSquad,
  deleteSquad,
  fetchSquadMembers,
  inviteSquadMember,
  updateSquadMember,
  removeSquadMember,
  fetchSquadInvitations,
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
  const [squadName, setSquadName] = useState('');
  const [archiveName, setArchiveName] = useState('');
  const [addSquad, setAddSquad] = useState(false);
  const [addArchive, setAddArchive] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Workspace name is required.'); return; }
    try {
      await createWorkspace(name, {
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
        <label htmlFor="workspace-name">Workspace Name:</label>
        <input
          id="workspace-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />

        <label className="setup-checkbox">
          <input type="checkbox" checked={addSquad} onChange={(e) => {
            setAddSquad(e.target.checked);
            if (!e.target.checked) setAddArchive(false);
          }} />
          Also create a squad
        </label>
        {addSquad && (
          <>
            <input
              type="text" value={squadName}
              onChange={(e) => setSquadName(e.target.value)}
              placeholder="e.g. Engineering"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <label className="setup-checkbox">
              <input type="checkbox" checked={addArchive} onChange={(e) => setAddArchive(e.target.checked)} />
              Also create a archive
            </label>
            {addArchive && (
              <input
                type="text" value={archiveName}
                onChange={(e) => setArchiveName(e.target.value)}
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

function RenameOrgModal({ workspace, onRenamed }) {
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    try {
      await updateWorkspace(workspace.id, name);
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming workspace.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Workspace</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-workspace">Name:</label>
        <input
          id="rename-workspace" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

function NewSquadModal({ workspaceId, onCreated }) {
  const [name, setName] = useState('');
  const [archiveName, setArchiveName] = useState('');
  const [addArchive, setAddArchive] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Squad name is required.'); return; }
    try {
      await createSquad(workspaceId, name, {
        archiveName: addArchive ? archiveName.trim() || undefined : undefined,
      });
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating squad.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Squad</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="squad-name">Squad Name:</label>
        <input id="squad-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <label className="setup-checkbox">
          <input type="checkbox" checked={addArchive} onChange={(e) => setAddArchive(e.target.checked)} />
          Also create a archive
        </label>
        {addArchive && (
          <input
            type="text" value={archiveName}
            onChange={(e) => setArchiveName(e.target.value)}
            placeholder="e.g. Documentation"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        )}
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function RenameSquadModal({ squad, onRenamed }) {
  const [name, setName] = useState(squad.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    try {
      await updateSquad(squad.id, name);
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming squad.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Squad</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-squad">Name:</label>
        <input id="rename-squad" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

// --- Invite Member Modal ---

function InviteMemberModal({ squadId, onInvited }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('member');
  const [perms, setPerms] = useState({ can_read: true, can_write: false, can_create_log: false, can_create_archive: false, can_manage_members: false, can_delete_version: false });
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
      await inviteSquadMember(squadId, { userId: selected.id, role, ...perms });
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
            ['can_read', 'Read', 'View archives and logs'],
            ['can_write', 'Write', 'Edit logs and documents'],
            ['can_create_log', 'Create Logs', 'Create new logs in archives'],
            ['can_create_archive', 'Create Archives', 'Create new archives in the squad'],
            ['can_manage_members', 'Manage Members', 'Invite/remove squad members'],
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

// --- Squad Members Panel (inline in squad row) ---

const PERM_LABELS = {
  can_read: 'Read',
  can_write: 'Write',
  can_create_log: 'Create Logs',
  can_create_archive: 'Create Archives',
  can_manage_members: 'Manage Members',
  can_delete_version: 'Delete Versions',
};

function SquadMembersPanel({ squadId }) {
  const [members, setMembers] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([
        fetchSquadMembers(squadId),
        fetchSquadInvitations(squadId),
      ]);
      setMembers(mRes.members || []);
      setPending(iRes.invitations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [squadId]);

  useEffect(() => { load(); }, [load]);

  const handleTogglePerm = async (member, key) => {
    try {
      await updateSquadMember(squadId, member.user_id, { [key]: !member[key] });
      setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, [key]: !m[key] } : m));
    } catch (e) { toastError(e); }
  };

  const handleRoleChange = async (member, newRole) => {
    try {
      await updateSquadMember(squadId, member.user_id, { role: newRole });
      setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role: newRole } : m));
    } catch (e) { toastError(e); }
  };

  const handleRemove = (member) => {
    showModal(
      <ConfirmDialog
        title="Remove Member"
        message={`Remove ${member.name} from this squad?`}
        onConfirm={async () => {
          await removeSquadMember(squadId, member.user_id);
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
    <div className="squad-members-panel">
      <div className="squad-members-panel__header">
        <span className="text-muted text-sm">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => showModal(<InviteMemberModal squadId={squadId} onInvited={load} />, 'modal-lg')}
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

// --- Inline Squads for a Workspace ---

function OrgSquads({ workspaceId, highlightSquadId }) {
  const navigate = useNavigate();
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSquad, setExpandedSquad] = useState(highlightSquadId ? Number(highlightSquadId) : null);
  const scrolledSquadRef = useRef(false);

  const loadSquads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSquads(workspaceId);
      setSquads(res.squads || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadSquads(); }, [loadSquads]);

  const handleDeleteSquad = (squad) => {
    showModal(
      <ConfirmDialog
        title="Delete Squad"
        message={`Are you sure you want to delete "${squad.name}"? All archives in this squad will lose their squad association.`}
        onConfirm={async () => {
          await deleteSquad(squad.id);
          destroyModal();
          loadSquads();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <div className="workspace-squads">
      <div className="workspace-squads__header">
        <h4>Squads</h4>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => showModal(<NewSquadModal workspaceId={workspaceId} onCreated={loadSquads} />, 'modal-md')}
        >
          + New Squad
        </button>
      </div>
      {loading && <p className="text-muted text-sm">Loading squads...</p>}
      {!loading && squads.length === 0 && (
        <p className="text-muted text-sm">No squads yet.</p>
      )}
      {!loading && squads.length > 0 && (
        <ul className="settings-item-list compact">
          {squads.map(squad => (
            <li key={squad.id} className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}
              ref={highlightSquadId && squad.id === Number(highlightSquadId) ? (el) => {
                if (el && !scrolledSquadRef.current) {
                  scrolledSquadRef.current = true;
                  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                }
              } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpandedSquad(prev => prev === squad.id ? null : squad.id)}>
                  <span style={{ fontSize: '0.8em', marginRight: 6 }}>{expandedSquad === squad.id ? '▾' : '▸'}</span>
                  <span>{squad.name}</span>
                  <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                    Created: {new Date(squad.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="card__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/archives?squad=${squad.id}&workspace=${workspaceId}`)}
                  >
                    Archives
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => showModal(<RenameSquadModal squad={squad} onRenamed={loadSquads} />, 'modal-md')}
                  >
                    Rename
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSquad(squad)}>Delete</button>
                </div>
              </div>
              {expandedSquad === squad.id && (
                <SquadMembersPanel squadId={squad.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WorkspacesPage() {
  const { workspaceId } = useParams();
  const [searchParams] = useSearchParams();
  const squadParam = searchParams.get('squad');
  const [workspaces, setWorkspaces] = useState([]);
  const [expandedOrg, setExpandedOrg] = useState(workspaceId ? Number(workspaceId) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const scrolledWorkspaceRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workspaceRes, adminRes] = await Promise.all([
        fetchWorkspaces(),
        fetchAdminStatus().catch(() => ({ isAdmin: false })),
      ]);
      setWorkspaces(workspaceRes.workspaces || []);
      setIsAdmin(adminRes.isAdmin === true);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading workspaces.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (workspaceId) setExpandedOrg(Number(workspaceId));
  }, [workspaceId]);

  const handleDelete = (workspace) => {
    showModal(
      <ConfirmDialog
        title="Delete Workspace"
        message={`Are you sure you want to delete "${workspace.name}"? This will delete all squads, archives, and logs within it.`}
        onConfirm={async () => {
          await deleteWorkspace(workspace.id);
          destroyModal();
          if (expandedOrg === workspace.id) setExpandedOrg(null);
          load();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  const toggleOrg = (workspaceId) => {
    setExpandedOrg(prev => prev === workspaceId ? null : workspaceId);
  };

  return (
    <StdLayout>
      <div className="log-header">
        <h1>Workspaces</h1>
        {isAdmin && (
          <button
            className="btn btn-primary"
            onClick={() => showModal(<NewOrgModal onCreated={load} />, 'modal-md')}
          >
            + New Workspace
          </button>
        )}
      </div>

      {loading && <p className="text-muted">Loading workspaces...</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && workspaces.length === 0 && (
        <div className="empty-state">
          <p>No workspaces yet. Create one to get started.</p>
        </div>
      )}

      <div className="workspace-list">
        {workspaces.map(workspace => (
          <div key={workspace.id} className={`card ${expandedOrg === workspace.id ? 'card--expanded' : ''}`}
            ref={workspaceId && workspace.id === Number(workspaceId) ? (el) => {
              if (el && !scrolledWorkspaceRef.current) {
                scrolledWorkspaceRef.current = true;
                requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }
            } : undefined}>
            <div className="card__body" onClick={() => toggleOrg(workspace.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8em' }}>{expandedOrg === workspace.id ? '▾' : '▸'}</span>
                <h3 className="card__title" style={{ margin: 0 }}>{workspace.name}</h3>
              </div>
              <p className="card__meta">Owner: {workspace.owner} &middot; Created: {new Date(workspace.created_at).toLocaleDateString()}</p>
            </div>
            <div className="card__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(<RenameOrgModal workspace={workspace} onRenamed={load} />, 'modal-md')}
              >
                Rename
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(workspace)}>
                Delete
              </button>
            </div>
            {expandedOrg === workspace.id && (
              <div className="card__expanded-content" style={{ padding: '0 16px 16px' }}>
                <OrgSquads workspaceId={workspace.id} highlightSquadId={expandedOrg === workspace.id ? squadParam : null} />
              </div>
            )}
          </div>
        ))}
      </div>
    </StdLayout>
  );
}
