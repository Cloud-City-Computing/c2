import { useEffect } from 'react';

/**
 * Close a dropdown/popover when the user clicks outside.
 * @param {React.RefObject} ref - ref attached to the container element
 * @param {boolean} active - only listen when true
 * @param {() => void} onClose - callback to dismiss
 */
export default function useClickOutside(ref, active, onClose) {
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [ref, active, onClose]);
}
