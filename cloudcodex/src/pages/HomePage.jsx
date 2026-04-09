/**
 * Cloud Codex - Home Log
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import ExploreBrowser from '../components/ExploreBrowser';
import { fetchMyInvitations, acceptInvitation, declineInvitation } from '../util';

function PendingInvitations() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyInvitations();
      setInvitations(res.invitations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAccept = async (inv) => {
    try {
      await acceptInvitation(inv.id);
      load();
    } catch { /* ignore */ }
  };

  const handleDecline = async (inv) => {
    try {
      await declineInvitation(inv.id);
      load();
    } catch { /* ignore */ }
  };

  if (loading || invitations.length === 0) return null;

  return (
    <section className="home-invitations">
      <h2>Pending Invitations</h2>
      <div className="invitation-list">
        {invitations.map(inv => (
          <div key={inv.id} className="invitation-card">
            <div className="invitation-card__info">
              <strong>{inv.squad_name}</strong>
              {inv.workspace_name && <span className="text-muted text-sm"> in {inv.workspace_name}</span>}
              <p className="text-muted text-sm">
                Invited by {inv.invited_by_name} &middot; Role: {inv.role}
                &middot; {new Date(inv.created_at).toLocaleDateString()}
              </p>
              <div className="invitation-card__perms">
                {inv.can_read && <span className="perm-badge">Read</span>}
                {inv.can_write && <span className="perm-badge">Write</span>}
                {inv.can_create_log && <span className="perm-badge">Create Logs</span>}
                {inv.can_create_archive && <span className="perm-badge">Create Archives</span>}
                {inv.can_manage_members && <span className="perm-badge">Manage Members</span>}
                {inv.can_delete_version && <span className="perm-badge">Delete Versions</span>}
              </div>
            </div>
            <div className="invitation-card__actions">
              <button className="btn btn-primary btn-sm" onClick={() => handleAccept(inv)}>Accept</button>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDecline(inv)}>Decline</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <StdLayout>
      <div className="home-log">
        <section className="home-hero">
          <h1>Welcome to Cloud Codex</h1>
          <p className="text-muted">Your collaborative document workspace. Browse and search your documents below.</p>
        </section>

        <PendingInvitations />

        <ExploreBrowser />
      </div>
    </StdLayout>
  );
}