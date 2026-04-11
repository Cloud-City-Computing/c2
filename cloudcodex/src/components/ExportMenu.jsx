import { useState, useRef, useCallback } from 'react';
import useClickOutside from '../hooks/useClickOutside';

const FORMATS = [
  ['html', 'HTML (.html)'],
  ['md', 'Markdown (.md)'],
  ['txt', 'Plain Text (.txt)'],
  ['pdf', 'PDF (.pdf)'],
  ['docx', 'Word (.docx)'],
];

/**
 * Reusable dropdown menu for document export.
 * @param {{ onExport: (format: string) => void, btnClass?: string, btnLabel?: string, menuClass?: string }} props
 */
export default function ExportMenu({ onExport, btnClass = 'btn btn-ghost btn-sm', btnLabel = '📥 Export ▾', menuClass = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
          {FORMATS.map(([fmt, label]) => (
            <button key={fmt} className="export-dropdown__item" onClick={() => handleClick(fmt)}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
