/**
 * Cloud Codex - the one empty state (W6-CDX-41, Task 4.2)
 *
 * Every empty list says the same thing the same way: a Poppins title that names what is missing, one line that says
 * what will appear or what to do, and an optional single action. Home, an empty document tree, Notifications and
 * Activity render it; no list says "No ..." in a bare paragraph any more.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

export default function EmptyState({ title, children, action, className = '' }) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ''}`}>
      <h2 className="empty-state__title">{title}</h2>
      {children && <p className="empty-state__body">{children}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
