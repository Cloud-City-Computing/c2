/**
 * Cloud Codex - Welcome Setup Component
 *
 * The first-run welcome. It teaches the hierarchy by naming what the user
 * already has rather than by creating anything: everything it points at was
 * seeded at boot or joined through an invitation.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { Link } from 'react-router-dom';

export default function WelcomeSetup({ firstRun, onFinish }) {
  const { isAdmin, squad, archive, log, pendingSquadInvites } = firstRun;

  return (
    <div className="modal-content welcome-setup">
      <h2>Welcome to Cloud Codex</h2>

      {squad ? (
        <>
          <p className="welcome-subtitle">
            Cloud Codex organises work in four levels: a <strong>workspace</strong> holds
            <strong> squads</strong>, a squad holds <strong>archives</strong>, and an archive holds
            your <strong>documents</strong>. Here is what you already have.
          </p>
          <ul className="welcome-hierarchy">
            <li>Your squad: <strong>{squad.name}</strong></li>
            {archive && <li>Your archive: <strong>{archive.name}</strong></li>}
            {archive && log && (
              <li>
                Start here: <Link to={`/archives/${archive.id}/doc/${log.id}`}>{log.title}</Link>
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="welcome-subtitle">
          You are not part of a squad yet, so there is nothing to read here just yet.
          {pendingSquadInvites > 0
            ? ` You have ${pendingSquadInvites} pending squad invitations waiting on your home page.`
            : ' Ask your administrator to add you to a squad, or to re-send your invitation with one attached.'}
        </p>
      )}

      <div className="welcome-actions">
        {isAdmin && (
          <Link className="btn btn-primary" to="/admin" onClick={onFinish}>
            Invite your team
          </Link>
        )}
        <button className={isAdmin ? 'btn btn-ghost' : 'btn btn-primary'} onClick={onFinish}>
          Get Started
        </button>
      </div>
    </div>
  );
}
