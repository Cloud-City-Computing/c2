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
  showModal,
  destroyModal,
} from '../util';
import ConfirmDialog from '../components/ConfirmDialog';

function NewOrgModal({ onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Organization name is required.'); return; }
    try {
      await createOrganization(name);
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
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required.'); return; }
    try {
      await createTeam(orgId, name);
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

// --- Inline Teams for an Organization ---

function OrgTeams({ orgId }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

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
            <li key={team.id} className="settings-item">
              <div style={{ flex: 1 }}>
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOrganizations();
      setOrgs(res.organizations || []);
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
        <button
          className="btn btn-primary"
          onClick={() => showModal(<NewOrgModal onCreated={load} />, 'modal-md')}
        >
          + New Organization
        </button>
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
