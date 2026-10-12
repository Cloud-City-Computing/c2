/**
 * Cloud Codex - the menu primitive (W6-CDX-39, Task 2.3, momus round 1)
 *
 * A trigger button and a single-choice popup (role="menu" of role="menuitemradio" with aria-checked).
 * The trigger's name carries the label and the visible choice, so the text a sighted user reads is in the
 * accessible name (WCAG 2.5.3). The popup is portalled into its own node, #menu-root, which showDropdownMenu
 * never toggles or clears; when the trigger sits inside an aria-modal dialog it is portalled into that dialog,
 * so the dialog's focus trap and the accessibility tree both reach it. Its position follows the trigger on
 * scroll and resize. Keyboard: arrows wrap, Home and End jump, a letter jumps to the next item starting with
 * it, Escape and Tab close it and return focus to the trigger. An outside pointer press closes it. No scrim.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from './icons.jsx';

const TYPEAHEAD_MS = 500;

/** The node the popup lives in when the trigger is not inside a dialog. Created once; nothing else writes to it. */
function menuRoot() {
  let el = document.getElementById('menu-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'menu-root';
    document.body.appendChild(el);
  }
  return el;
}

/** Where a popup for this trigger is portalled: the aria-modal dialog it is in, or the menu root. */
function containerFor(trigger) {
  return trigger?.closest('[aria-modal="true"]') ?? menuRoot();
}

/**
 * The popup's coordinates. Fixed to the viewport in the menu root. Inside a dialog it is absolute to the dialog,
 * which is a containing block for it (the dialog's transform makes it one), so the trigger's rectangle is taken
 * relative to the dialog's border box.
 */
function placeFor(trigger, container) {
  const r = trigger.getBoundingClientRect();
  if (container === menuRoot()) {
    return { position: 'fixed', top: r.bottom + 4, left: r.left, minWidth: r.width };
  }
  const c = container.getBoundingClientRect();
  return {
    position: 'absolute',
    top: r.bottom - c.top - container.clientTop + 4,
    left: r.left - c.left - container.clientLeft,
    minWidth: r.width,
  };
}

/**
 * @param {object} props
 * @param {string} props.label           the menu's name; the trigger is named "label: current choice"
 * @param {string} [props.value]         key of the current item
 * @param {Array<{key: string, label: string, disabled?: boolean}>} props.items
 * @param {(key: string) => void} props.onSelect
 * @param {string} [props.id]            id of the trigger, so a <label htmlFor> can name it
 * @param {string} [props.className]     extra class on the trigger
 */
export default function Menu({ label, value, items, onSelect, id: triggerId, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [container, setContainer] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const typeahead = useRef({ text: '', at: 0 });
  const id = useId();
  const current = items.find((i) => i.key === value);
  const choice = current?.label ?? '';

  // Place the popup where its trigger is, and again whenever the page scrolls or resizes. The scroll listener
  // is on the capture phase, so a scroll of any ancestor (a scrolling dialog body, a list) moves the popup too.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const trig = triggerRef.current;
      if (trig) setPos(placeFor(trig, containerFor(trig)));
    };
    const trig = triggerRef.current;
    setContainer(containerFor(trig));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Focus the current item (or the first) once the popup is mounted: it mounts on the render after `pos` is set.
  useEffect(() => {
    if (!open || !pos) return;
    const list = popRef.current;
    if (!list) return;
    const first = list.querySelector('[aria-checked="true"]') || list.querySelector('[role="menuitemradio"]');
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

  // Typeahead: a letter typed within the window extends the prefix. A repeated letter cycles through the items
  // starting with it, after the focused one. A prefix with no match falls back to its last letter alone.
  const jumpByLetter = (key, enabled, at) => {
    const now = Date.now();
    const buf = typeahead.current;
    buf.text = now - buf.at > TYPEAHEAD_MS ? key : buf.text + key;
    buf.at = now;
    const labels = enabled.map((el) => el.textContent.trim().toLowerCase());
    const repeated = buf.text.split('').every((c) => c === buf.text[0]);
    const needles = repeated ? [buf.text[0]] : [buf.text, key];
    for (const needle of needles) {
      const start = repeated ? at + 1 : at;
      for (let n = 0; n < enabled.length; n += 1) {
        const i = (start + n + enabled.length) % enabled.length;
        if (labels[i].startsWith(needle)) {
          enabled[i].focus();
          return;
        }
      }
    }
  };

  const onKeyDown = (e) => {
    const list = popRef.current;
    if (!list) return;
    const enabled = [...list.querySelectorAll('[role="menuitemradio"]:not(:disabled)')];
    const at = enabled.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      // Stopped here so the dialog's own Escape and Tab handling never sees the key that closed the menu.
      e.preventDefault();
      e.stopPropagation();
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
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      jumpByLetter(e.key.toLowerCase(), enabled, at);
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
        aria-label={choice ? `${label}: ${choice}` : label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="menu-trigger__value">{choice}</span>
        <span className="menu-trigger__chevron"><ChevronDownIcon /></span>
      </button>
      {open && pos && container && createPortal(
        <div
          ref={popRef}
          id={id}
          role="menu"
          aria-label={label}
          className="menu"
          style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth, position: pos.position }}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.key === value ? 'true' : 'false'}
              className="menu__item"
              disabled={item.disabled}
              onClick={() => choose(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>,
        container,
      )}
    </>
  );
}
