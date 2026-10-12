/**
 * Cloud Codex - the stroke icon set (W6-CDX-39, Task 2.4)
 *
 * One family: 15 px, a 2 px stroke in currentColor, round caps and joins, decorative. Shell and content icons
 * outside the editor canvas use these, never an emoji.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

function Stroke({ children, fill = 'none' }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function ChevronDownIcon() {
  return <Stroke><polyline points="6 9 12 15 18 9" /></Stroke>;
}

export function CheckIcon() {
  return <Stroke><polyline points="20 6 9 17 4 12" /></Stroke>;
}

export function XIcon() {
  return <Stroke><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Stroke>;
}

export function InfoIcon() {
  return (
    <Stroke>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </Stroke>
  );
}

export function StarIcon({ filled = false }) {
  return (
    <Stroke fill={filled ? 'currentColor' : 'none'}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </Stroke>
  );
}

export function WarningIcon() {
  return (
    <Stroke>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </Stroke>
  );
}

export function CommentIcon() {
  return <Stroke><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Stroke>;
}

export function CircleIcon() {
  return <Stroke><circle cx="12" cy="12" r="9" /></Stroke>;
}
