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

/** The "More actions" trigger on a list row: three dots, filled so they read at 15 px. */
export function MoreIcon() {
  return (
    <Stroke>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Stroke>
  );
}

export function PencilIcon() {
  return (
    <Stroke>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Stroke>
  );
}

export function EyeIcon() {
  return (
    <Stroke>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </Stroke>
  );
}

export function SaveIcon() {
  return (
    <Stroke>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </Stroke>
  );
}

export function PackageIcon() {
  return (
    <Stroke>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </Stroke>
  );
}

export function HistoryIcon() {
  return (
    <Stroke>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <polyline points="12 7 12 12 15 14" />
    </Stroke>
  );
}

export function ListIcon() {
  return (
    <Stroke>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </Stroke>
  );
}

export function TrayIcon() {
  return (
    <Stroke>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Stroke>
  );
}
