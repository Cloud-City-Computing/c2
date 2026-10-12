/**
 * Cloud Codex - the avatar (W6-CDX-39, Task 2.4)
 *
 * A photo when the user has one; otherwise the initial on one of the package's --avatar-1..8 tints. The tint is
 * a stable hash of the user id, so one person keeps one colour across every list. The initial is the dark ink.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { avatarTint } from '../lib/avatar-tint.js';

/**
 * @param {object} props
 * @param {string|number} [props.id]    the user id, for the stable tint
 * @param {string} [props.name]         the initial is taken from this
 * @param {string} [props.src]          a photo; when set, the photo is shown
 * @param {number} [props.size]        the diameter in px (the list avatars are 28 and 32)
 * @param {string} [props.className]   extra classes, so a list keeps its own placement class
 */
export default function Avatar({ id, name, src, size = 24, className = '' }) {
  const classes = ['avatar', className].filter(Boolean).join(' ');
  if (src) {
    return <img className={`${classes} avatar--photo`} src={src} alt="" width={size} height={size} data-size={size} />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={classes}
      aria-hidden="true"
      data-size={size}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `var(--avatar-${avatarTint(id ?? name)})`,
      }}
    >
      {initial}
    </span>
  );
}
