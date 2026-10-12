/**
 * Cloud Codex - the page header (W6-CDX-40, K1)
 *
 * Every page's header: a Poppins 24 px title, a faint meta line, the page's one primary action, a toolbar slot
 * on the right, then the theme toggle on every page (W6-CDX-44), and an optional tab row under it where the page
 * has sections. The title is the page's h1.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import ThemeToggle from './ThemeToggle.jsx';

export default function PageHeader({ title, meta, primary, toolbar, tabs }) {
  return (
    <div className="page-header">
      <div className="page-header__row">
        <div className="page-header__titles">
          <h1 className="page-header__title">{title}</h1>
          {meta && <p className="page-header__meta">{meta}</p>}
        </div>
        <div className="page-header__actions">
          {primary}
          {toolbar}
          <ThemeToggle />
        </div>
      </div>
      {tabs && <div className="page-header__tabs">{tabs}</div>}
    </div>
  );
}
