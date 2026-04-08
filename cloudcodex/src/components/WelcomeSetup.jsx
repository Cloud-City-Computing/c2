/**
 * Cloud Codex - Welcome Setup Component
 *
 * Shown after a new user creates an account.
 * Optionally creates a default organization, team, and project.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { destroyModal } from '../util';

export default function WelcomeSetup({ onComplete }) {
  const handleContinue = () => {
    destroyModal();
    onComplete?.();
  };

  return (
    <div className="modal-content welcome-setup">
      <h2>Welcome to Cloud Codex!</h2>
      <p className="welcome-subtitle">
        Your account has been created. Your administrator will assign you to organizations and teams.
      </p>
      <div className="welcome-actions">
        <button className="btn btn-primary" onClick={handleContinue}>
          Get Started
        </button>
      </div>
    </div>
  );
}
