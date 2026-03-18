/**
 * Cloud Codex - Home Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { fetchProjects, fetchPages, fetchMyInvitations, acceptInvitation, declineInvitation } from '../util';

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
              <strong>{inv.team_name}</strong>
              {inv.org_name && <span className="text-muted text-sm"> in {inv.org_name}</span>}
              <p className="text-muted text-sm">
                Invited by {inv.invited_by_name} &middot; Role: {inv.role}
                &middot; {new Date(inv.created_at).toLocaleDateString()}
              </p>
              <div className="invitation-card__perms">
                {inv.can_read && <span className="perm-badge">Read</span>}
                {inv.can_write && <span className="perm-badge">Write</span>}
                {inv.can_create_page && <span className="perm-badge">Create Pages</span>}
                {inv.can_create_project && <span className="perm-badge">Create Projects</span>}
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
  const navigate = useNavigate();
  const [recentPages, setRecentPages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProjects();
      const projects = res.projects || [];
      const allPages = [];
      for (const project of projects.slice(0, 5)) {
        try {
          const pagesRes = await fetchPages(project.id);
          const flatten = (pages) => {
            for (const p of pages) {
              allPages.push({ ...p, project_name: project.name });
              if (p.children?.length) flatten(p.children);
            }
          };
          flatten(pagesRes.pages || []);
        } catch { /* skip */ }
      }
      allPages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setRecentPages(allPages.slice(0, 8));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  return (
    <StdLayout>
      <div className="home-page">
        <section className="home-hero">
          <h1>Welcome to Cloud Codex</h1>
          <p className="text-muted">Your collaborative document workspace. Use the search bar above or navigate with the sidebar.</p>
        </section>

        <PendingInvitations />

        <section className="home-recent">
          <h2>Recent Pages</h2>
          {loading && <p className="text-muted">Loading...</p>}
          {!loading && recentPages.length === 0 && (
            <p className="text-muted">No pages yet. Head to Projects to create your first document.</p>
          )}
          {!loading && recentPages.length > 0 && (
            <div className="card-grid">
              {recentPages.map(page => (
                <div key={page.id} className="card card--action" onClick={() => navigate(`/editor/${page.id}`)}>
                  <div className="card__body">
                    <h3 className="card__title">{page.title}</h3>
                    <p className="card__meta">{page.project_name}</p>
                    {page.created_at && (
                      <p className="card__meta">{new Date(page.created_at).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </StdLayout>
  );
}