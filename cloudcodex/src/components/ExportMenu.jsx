import { useState, useRef, useCallback, Fragment } from 'react';
import useClickOutside from '../hooks/useClickOutside';
import useGitHubStatus from '../hooks/useGitHubStatus';

const FORMATS = [
  ['html', 'HTML (.html)'],
  ['md', 'Markdown (.md)'],
  ['txt', 'Plain Text (.txt)'],
  ['pdf', 'PDF (.pdf)'],
  ['docx', 'Word (.docx)'],
  ['github', 'Push to GitHub'],
];

/**
 * Reusable dropdown menu for document export.
 * @param {{ onExport: (format: string) => void, btnClass?: string, btnLabel?: string, menuClass?: string }} props
 */
export default function ExportMenu({ onExport, btnClass = 'btn btn-ghost btn-sm', btnLabel = '📥 Export ▾', menuClass = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { connected: githubConnected } = useGitHubStatus();
  const formats = githubConnected === false ? FORMATS.filter(([fmt]) => fmt !== 'github') : FORMATS;

  useClickOutside(ref, open, useCallback(() => setOpen(false), []));

  const handleClick = (fmt) => {
    setOpen(false);
    onExport(fmt);
  };

  return (
    <div className="export-dropdown" ref={ref}>
      <button className={btnClass} onClick={() => setOpen(v => !v)}>{btnLabel}</button>
      {open && (
        <div className={`export-dropdown__menu ${menuClass}`}>
          {formats.map(([fmt, label]) => (
            <Fragment key={fmt}>
              {fmt === 'github' && <hr className="export-dropdown__separator" />}
              <button className={`export-dropdown__item${fmt === 'github' ? ' export-dropdown__item--github' : ''}`} onClick={() => handleClick(fmt)}>{label}</button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
