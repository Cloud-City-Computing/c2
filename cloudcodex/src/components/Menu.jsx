/**
 * Cloud Codex - the menu primitive (W6-CDX-39, Task 2.3)
 *
 * A trigger button and a popup of menu items. The popup is portalled into #dropdown-root (or the body) at
 * fixed coordinates taken from the trigger, with no scrim: a menu is not a modal. Keyboard: Arrow keys wrap,
 * Home and End jump, Escape closes and returns focus to the trigger. An outside pointer press closes it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from './icons.jsx';

/**
 * @param {object} props
 * @param {string} props.label           accessible name of the menu (and the trigger's label prefix)
 * @param {string} [props.value]         key of the current item, marked with aria-current
 * @param {Array<{key: string, label: string, disabled?: boolean}>} props.items
 * @param {(key: string) => void} props.onSelect
 * @param {string} [props.id]            id of the trigger, so a <label htmlFor> can name it
 * @param {string} [props.className]     extra class on the trigger
 * @param {React.ReactNode} [props.children] trigger content; defaults to the current item's label
 */
export default function Menu({ label, value, items, onSelect, id: triggerId, className = '', children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const id = useId();
  const current = items.find((i) => i.key === value);

  // Position the popup under the trigger's left edge while it is open.
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, minWidth: r.width });
  }, [open]);

  // Focus the current item (or the first) once the popup is mounted: it mounts on the render after `pos` is set.
  useEffect(() => {
    if (!open || !pos) return;
    const list = popRef.current;
    if (!list) return;
    const first = list.querySelector('[aria-current="true"]') || list.querySelector('[role="menuitem"]');
    first?.focus();
  }, [open, pos]);

  // An outside press closes it. A press on the trigger is left to the trigger's own click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e) => {
    const list = popRef.current;
    if (!list) return;
    const enabled = [...list.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const at = enabled.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      enabled[(at + 1 + enabled.length) % enabled.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      enabled[(at - 1 + enabled.length) % enabled.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      enabled[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      enabled[enabled.length - 1]?.focus();
    }
  };

  const choose = (key) => {
    onSelect(key);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`menu-trigger ${className}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="menu-trigger__value">{children ?? current?.label}</span>
        <span className="menu-trigger__chevron"><ChevronDownIcon /></span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          id={id}
          role="menu"
          aria-label={label}
          className="menu"
          style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={item.disabled}
              aria-current={item.key === value ? 'true' : undefined}
              onClick={() => choose(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.getElementById('dropdown-root') || document.body,
      )}
    </>
  );
}
