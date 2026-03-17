/**
 * Cloud Codex - Teams Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  showModal,
  destroyModal,
} from '../util';
import ConfirmDialog from '../components/ConfirmDialog';

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

export default function TeamsPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTeams(orgId);
      setTeams(res.teams || []);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading teams.');
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (team) => {
    showModal(
      <ConfirmDialog
        title="Delete Team"
        message={`Are you sure you want to delete "${team.name}"? All projects in this team will lose their team association.`}
        onConfirm={async () => {
          await deleteTeam(team.id);
          destroyModal();
          load();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <StdLayout>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/organizations')}>&larr; Organizations</button>
          <h1>Teams</h1>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => showModal(<NewTeamModal orgId={orgId} onCreated={load} />, 'modal-md')}
        >
          + New Team
        </button>
      </div>

      {loading && <p className="text-muted">Loading teams...</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && teams.length === 0 && (
        <div className="empty-state">
          <p>No teams in this organization yet.</p>
        </div>
      )}

      <div className="card-grid">
        {teams.map(team => (
          <div key={team.id} className="card" onClick={() => navigate(`/projects?team=${team.id}`)}>
            <div className="card__body">
              <h3 className="card__title">{team.name}</h3>
              <p className="card__meta">Created by: {team.created_by}</p>
              <p className="card__meta">Created: {new Date(team.created_at).toLocaleDateString()}</p>
            </div>
            <div className="card__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(<RenameTeamModal team={team} onRenamed={load} />, 'modal-md')}
              >
                Rename
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(team)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </StdLayout>
  );
}
