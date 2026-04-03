/**
 * Cloud Codex - Welcome Setup Component
 *
 * Shown after a new user creates an account.
 * Optionally creates a default organization, team, and project.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { destroyModal, setupWorkspace } from '../util';

export default function WelcomeSetup({ onComplete }) {
  const [wantSetup, setWantSetup] = useState(null); // null = asking, true = form, false = skip
  const [orgName, setOrgName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [addTeam, setAddTeam] = useState(true);
  const [addProject, setAddProject] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSkip = () => {
    destroyModal();
    onComplete?.();
  };

  const handleSubmit = async () => {
    setError(null);
    if (!orgName.trim()) { setError('Organization name is required.'); return; }

    setLoading(true);
    try {
      await setupWorkspace({
        orgName: orgName.trim(),
        teamName: addTeam ? teamName.trim() || undefined : undefined,
        projectName: addProject ? projectName.trim() || undefined : undefined,
      });
      destroyModal();
      onComplete?.();
    } catch (e) {
      setError(e.body?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Ask whether to set up
  if (wantSetup === null) {
    return (
      <div className="modal-content welcome-setup">
        <h2>Welcome to Cloud Codex!</h2>
        <p className="welcome-subtitle">
          Would you like to set up an organization, team, and project to get started?
        </p>
        <div className="welcome-actions">
          <button className="btn btn-primary" onClick={() => setWantSetup(true)}>
            Yes, set me up
          </button>
          <button className="btn btn-ghost" onClick={handleSkip}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Collect names
  return (
    <div className="modal-content welcome-setup">
      <h2>Quick Setup</h2>
      <p className="welcome-subtitle">Create your workspace in one step.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="setup-org">Organization Name:</label>
        <input
          id="setup-org" type="text" value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="e.g. Acme Corp"
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

        <button
          className="btn btn-primary stretched-button"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Creating…' : 'Create Workspace'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleSkip} style={{ marginTop: '4px' }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
