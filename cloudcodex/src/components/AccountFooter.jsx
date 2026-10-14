/**
 * Cloud Codex - the sidebar's account footer (W6-CDX-40, X6)
 *
 * An avatar, the name and a sign-out icon button. The name opens a small NON-MODAL menu (no scrim, so the page
 * behind stays undimmed) with Account settings, Admin for an admin, and Sign out. Keyboard: Enter or Space opens
 * the menu on the name; arrow keys, Home and End move between its items; Escape closes it and returns focus to the
 * name; Tab out of it or an outside press closes it. The name is ellipsised and never cut to one letter.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import { SignOutIcon } from './ShellIcons.jsx';
import { signOut } from '../lib/sign-out.js';

export default function AccountFooter({ user, isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const nameRef = useRef(null);
  const menuId = useId();
  const location = useLocation();

  // A change of page closes the menu.
  const [shownKey, setShownKey] = useState(location.key);
  if (shownKey !== location.key) {
    setShownKey(location.key);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onEscape(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      nameRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  // Arrow keys, Home and End move between the menu's items; Tab out closes the menu.
  function onMenuKeyDown(event) {
    const items = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  function onRootBlur(event) {
    if (!open) return;
    const next = event.relatedTarget;
    if (next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
  }

  const name = user.name || user.email || 'Account';

  return (
    <div className="sidebar__account" ref={rootRef} onBlur={onRootBlur}>
      <div className="sidebar__who">
        <button
          ref={nameRef}
          type="button"
          className="sidebar__name"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={name}
          onClick={() => setOpen((o) => !o)}
        >
          <Avatar id={user.id} name={name} src={user.avatar_url || undefined} size={28} className="sidebar__avatar" />
          <span className="sidebar__name-text">{name}</span>
        </button>
        <div id={menuId} role="menu" aria-label="Account" className="sidebar__menu" hidden={!open} onKeyDown={onMenuKeyDown}>
          <Link role="menuitem" className="sidebar__menu-item" to="/account" onClick={() => setOpen(false)}>Account settings</Link>
          {isAdmin && (
            <Link role="menuitem" className="sidebar__menu-item" to="/admin" onClick={() => setOpen(false)}>Admin</Link>
          )}
          <button role="menuitem" type="button" className="sidebar__menu-item" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
      <button type="button" className="btn-icon sidebar__signout" aria-label="Sign out" title="Sign out" onClick={() => signOut()}>
        <SignOutIcon />
      </button>
    </div>
  );
}
