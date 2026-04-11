import { useState } from 'react';
import { createLog, destroyModal } from '../util';

/**
 * Reusable modal for creating a new log/page inside an archive.
 * @param {{ archiveId: number, parentId?: number, onCreated?: (id: number) => void, heading?: string, label?: string }} props
 */
export default function NewLogModal({ archiveId, parentId, onCreated, heading = 'New Log', label = 'Log Title:' }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) { setError('Title is required.'); return; }
    try {
      const res = await createLog(archiveId, title, parentId);
      destroyModal();
      onCreated?.(res.logId);
    } catch (e) {
      setError(e.body?.message ?? 'Error creating log.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>{heading}</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="log-title">{label}</label>
        <input id="log-title" type="text" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}
