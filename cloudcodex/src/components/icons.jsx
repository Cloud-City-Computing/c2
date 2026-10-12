/**
 * Cloud Codex - the stroke icon set (W6-CDX-39, Task 2.4)
 *
 * One family: 15 px, a 2 px stroke in currentColor, round caps and joins, decorative. Shell and content icons
 * outside the editor canvas use these, never an emoji.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

function Stroke({ children }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
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
