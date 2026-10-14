/**
 * Cloud Codex - the sidebar (W6-CDX-40, K1, K5, K9, K10)
 *
 * The one full-height navigation column of the shell, top to bottom: the product mark, the workspace slot, the search
 * trigger, the navigation with Notifications' unread count and an Archives group, and the account footer.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch } from '../util.jsx';
import useGitHubStatus from '../hooks/useGitHubStatus';
import useNotificationChannel from '../hooks/useNotificationChannel';
import { revealInStrip } from '../lib/strip-focus.js';
import { readInboxCache, writeInboxCache } from '../lib/inbox-cache.js';
import ProductMark from './ProductMark.jsx';
import SearchPalette from './SearchPalette.jsx';
import AccountFooter from './AccountFooter.jsx';
import {
  HomeNavIcon, WorkspaceNavIcon, ActivityNavIcon, BellNavIcon, ArchiveNavIcon, GitHubNavIcon, ChevronNavIcon,
} from './ShellIcons.jsx';

/** The first workspace the user can see: { id, name } or null. */
function useWorkspace(user) {
  const [workspace, setWorkspace] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    apiFetch('GET', '/api/workspaces').then(
      (body) => { if (live && Array.isArray(body?.workspaces) && body.workspaces.length > 0) setWorkspace(body.workspaces[0]); },
      () => {},
    );
    return () => { live = false; };
  }, [user]);
  return workspace;
}

/** The archives the user can read, for the Archives group: [{ id, name }]. Shown from the cache at once on a remount. */
function useArchives(user) {
  const [archives, setArchives] = useState(() => readInboxCache(user?.id)?.archives ?? []);
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    apiFetch('GET', '/api/archives').then(
      (body) => {
        if (!live || !Array.isArray(body?.archives)) return;
        setArchives(body.archives);
        writeInboxCache(user.id, { archives: body.archives });
      },
      () => {},
    );
    return () => { live = false; };
  }, [user]);
  return archives;
}

// A prefix match marks a section active (/activity/workspace/1 under Activity). The root and "All archives"
// match exactly, or every page would look selected.
function isActive(pathname, to, exact = false) {
  return pathname === to || (!exact && to !== '/' && pathname.startsWith(to));
}

function NavItem({ to, label, Icon, pill, ariaLabel, exact = false }) {
  const location = useLocation();
  const active = isActive(location.pathname, to, exact);
  return (
    <Link
      to={to}
      className={`sidebar__link${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
    >
      <Icon />
      <span className="sidebar__label">{label}</span>
      {pill && <span className="sidebar__pill" aria-hidden="true">{pill}</span>}
    </Link>
  );
}

export default function Sidebar({ user, isAdmin }) {
  const { connected: githubConnected } = useGitHubStatus();
  const { unreadCount } = useNotificationChannel(Boolean(user), user?.id);
  const workspace = useWorkspace(user);
  const archives = useArchives(user);
  const location = useLocation();
  const workspaceName = workspace?.name || 'Workspace';
  const pill = unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : null;
  const notificationsLabel = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications';

  const slotBody = (
    <>
      <span className="workspace-slot__tile" aria-hidden="true">{workspaceName.trim().charAt(0).toUpperCase() || 'W'}</span>
      <span className="workspace-slot__text">
        <span className="workspace-slot__name" title={workspaceName}>{workspaceName}</span>
        <span className="workspace-slot__meta">Workspaces</span>
      </span>
      <ChevronNavIcon />
    </>
  );

  return (
    <aside className="sidebar">
      <Link to="/" className="sidebar__brand">
        <ProductMark className="sidebar__mark" />
        <span className="sidebar__brand-name">Cloud Codex</span>
      </Link>
      <Link to="/workspaces" className="workspace-slot workspace-slot--link">{slotBody}</Link>
      <SearchPalette />
      <nav className="sidebar__nav" aria-label="Primary" onFocus={(event) => revealInStrip(event.currentTarget, event.target)}>
        <div className="sidebar__scroll">
          <ul className="sidebar__list">
            <li><NavItem to="/" label="Home" Icon={HomeNavIcon} /></li>
            <li><NavItem to="/workspaces" label="Workspaces" Icon={WorkspaceNavIcon} /></li>
            <li><NavItem to="/activity" label="Activity" Icon={ActivityNavIcon} /></li>
            <li>
              <NavItem to="/notifications" label="Notifications" Icon={BellNavIcon} pill={pill} ariaLabel={notificationsLabel} />
            </li>
            {githubConnected !== false && (
              <li><NavItem to="/github" label="GitHub" Icon={GitHubNavIcon} /></li>
            )}
          </ul>
          <section className="sidebar__group" aria-labelledby="sidebar-archives-title">
            <p className="sidebar__group-title" id="sidebar-archives-title">Archives</p>
            <ul className="sidebar__list">
              <li><NavItem to="/archives" label="All archives" Icon={ArchiveNavIcon} exact /></li>
              {archives.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/archives/${a.id}`}
                    className={`sidebar__link sidebar__link--archive${isActive(location.pathname, `/archives/${a.id}`) ? ' active' : ''}`}
                    aria-current={isActive(location.pathname, `/archives/${a.id}`) ? 'page' : undefined}
                  >
                    <span className="sidebar__label">{a.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </nav>
      <div className="sidebar__footer">
        <AccountFooter user={user} isAdmin={isAdmin} />
      </div>
    </aside>
  );
}
