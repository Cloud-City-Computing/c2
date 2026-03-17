/**
 * Cloud Codex - Organizations Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import {
  fetchOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
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

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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

  const handleDelete = (org) => {
    showModal(
      <ConfirmDialog
        title="Delete Organization"
        message={`Are you sure you want to delete "${org.name}"? This will delete all teams, projects, and pages within it.`}
        onConfirm={async () => {
          await deleteOrganization(org.id);
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

      <div className="card-grid">
        {orgs.map(org => (
          <div key={org.id} className="card" onClick={() => navigate(`/organizations/${org.id}/teams`)}>
            <div className="card__body">
              <h3 className="card__title">{org.name}</h3>
              <p className="card__meta">Owner: {org.owner}</p>
              <p className="card__meta">Created: {new Date(org.created_at).toLocaleDateString()}</p>
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
          </div>
        ))}
      </div>
    </StdLayout>
  );
}
