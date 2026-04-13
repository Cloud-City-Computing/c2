/**
 * useCollab — React hook for real-time collaborative editing via WebSocket.
 *
 * Creates a Yjs Y.Doc and syncs it with the server using the y-protocols
 * binary sync protocol. The Y.Doc is bound to the Tiptap editor via the
 * @tiptap/extension-collaboration extension, giving true CRDT merge for
 * concurrent edits (no more last-writer-wins).
 *
 * Non-document messages (cursors, save, publish, comments, title, awareness)
 * continue to use JSON text frames.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { getSessionTokenFromCookie } from '../util';

/**
 * @param {number|string} logId  — The document/log ID to collaborate on
 * @param {function} onRemoteComment — Called when a peer performs a comment action
 * @param {function} onPublished — Called when the server confirms a version was published
 * @param {function} onRemoteTitle — Called when a peer changes the title
 * @returns {{ ydoc: Y.Doc, synced: boolean, collabUsers: Array, collabConnected: boolean, remoteCursors: Object, sendCursor: function, sendSave: function, sendPublish: function, sendTitle: function, sendCommentEvent: function, canWrite: boolean }}
 */
export default function useCollab(logId, onRemoteUpdate, onRemoteComment, onPublished, onRemoteTitle) {
  const [collabUsers, setCollabUsers] = useState([]);
  const [collabConnected, setCollabConnected] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [synced, setSynced] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState({});
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  // Keep callback refs up to date without re-creating the WebSocket
  const onRemoteCommentRef = useRef(onRemoteComment);
  const onPublishedRef = useRef(onPublished);
  const onRemoteTitleRef = useRef(onRemoteTitle);

  useEffect(() => { onRemoteCommentRef.current = onRemoteComment; }, [onRemoteComment]);
  useEffect(() => { onPublishedRef.current = onPublished; }, [onPublished]);
  useEffect(() => { onRemoteTitleRef.current = onRemoteTitle; }, [onRemoteTitle]);

  // One Y.Doc per logId — recreated when the logId changes.
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    return doc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId]);

  // Destroy previous Y.Doc when logId changes or component unmounts
  useEffect(() => {
    return () => { ydoc.destroy(); };
  }, [ydoc]);

  useEffect(() => {
    if (!logId) return;

    let disposed = false;

    function connect() {
      const token = getSessionTokenFromCookie();
      if (!token) return;

      setSynced(false);

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/collab?logId=${logId}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer'; // receive binary frames as ArrayBuffer
      wsRef.current = ws;

      // --- Y.Doc ↔ WebSocket bridge ---
      // Local Y.Doc changes are forwarded to the server as binary sync messages.
      // We gate on `syncComplete` so we don't send the Tiptap Collaboration
      // extension's initial-content write before the server sync finishes,
      // which would duplicate content if the server already has state.
      let syncComplete = false;
      const pendingUpdates = [];

      const docUpdateHandler = (update, origin) => {
        if (origin === ws) return; // don't echo server-originated updates back
        if (ws.readyState !== WebSocket.OPEN) return;

        if (!syncComplete) {
          pendingUpdates.push(update);
          return;
        }

        const encoder = encoding.createEncoder();
        syncProtocol.writeUpdate(encoder, update);
        ws.send(encoding.toUint8Array(encoder));
      };

      ydoc.on('update', docUpdateHandler);

      ws.onopen = () => {
        // Auth must be the first message
        ws.send(JSON.stringify({ type: 'auth', token }));
        if (!disposed) setCollabConnected(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;

        // --- Binary frame: Yjs sync/update ---
        if (event.data instanceof ArrayBuffer) {
          try {
            const data = new Uint8Array(event.data);
            const decoder = decoding.createDecoder(data);
            const encoder = encoding.createEncoder();
            const msgType = syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
            // If the sync protocol generated a response, send it
            if (encoding.length(encoder) > 1) {
              ws.send(encoding.toUint8Array(encoder));
            }
            // After receiving sync step 2 (the server's full state), we know
            // the Y.Doc is up to date and can start forwarding local edits.
            if (!syncComplete && msgType === syncProtocol.messageYjsSyncStep2) {
              syncComplete = true;
              // Flush any updates that were queued during the sync handshake
              for (const u of pendingUpdates) {
                const enc = encoding.createEncoder();
                syncProtocol.writeUpdate(enc, u);
                ws.send(encoding.toUint8Array(enc));
              }
              pendingUpdates.length = 0;
            }
          } catch (err) {
            console.error('[useCollab] binary message error', err);
          }
          return;
        }

        // --- Text frame: JSON ---
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'sync':
            // Server confirmed auth, sent permissions. Mark synced for UI.
            setCanWrite(msg.canWrite);
            setSynced(true);
            break;

          case 'awareness':
            setCollabUsers(msg.users || []);
            break;

          case 'cursor':
            setRemoteCursors(prev => ({
              ...prev,
              [msg.userId]: {
                userId: msg.userId,
                userName: msg.userName,
                color: msg.color,
                position: msg.position,
                timestamp: Date.now(),
              },
            }));
            break;

          case 'saved':
            // Server confirmed content save
            break;

          case 'published':
            onPublishedRef.current?.(msg);
            break;

          case 'comment':
            onRemoteCommentRef.current?.(msg);
            break;

          case 'title':
            onRemoteTitleRef.current?.(msg.title);
            break;
        }
      };

      ws.onclose = () => {
        ydoc.off('update', docUpdateHandler);
        if (!disposed) {
          setCollabConnected(false);
          setSynced(false);
          // Reconnect after a delay
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setCollabConnected(false);
      setCollabUsers([]);
      setRemoteCursors({});
      setSynced(false);
    };
  }, [logId, ydoc]);

  /**
   * Send local cursor/selection position to peers.
   * @param {{ index: number, length: number, context: string }} position
   */
  const sendCursor = useCallback((position) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cursor', position }));
    }
  }, []);

  /**
   * Request an immediate content save (no version snapshot).
   * Client sends its current HTML so the server can persist a display-ready copy.
   * Returns true if the message was sent, false if the WS wasn't open.
   * @param {{ html?: string }} [opts]
   * @returns {boolean}
   */
  const sendSave = useCallback((opts = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'save', html: opts.html }));
      return true;
    }
    return false;
  }, []);

  /**
   * Publish a formal version snapshot of the current document.
   * Returns a Promise that resolves with { version, title } on server
   * confirmation, or rejects if the send fails or times out.
   * @param {{ title?: string, notes?: string, html?: string }} [opts]
   * @returns {Promise<{ version: number, title?: string }>}
   */
  const sendPublish = useCallback((opts = {}) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      const PUBLISH_TIMEOUT_MS = 10000;
      const handler = (event) => {
        if (event.data instanceof ArrayBuffer) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'published') {
          clearTimeout(timer);
          wsRef.current?.removeEventListener('message', handler);
          resolve(msg);
        } else if (msg.type === 'error') {
          clearTimeout(timer);
          wsRef.current?.removeEventListener('message', handler);
          reject(new Error(msg.message || 'Publish failed'));
        }
      };
      const timer = setTimeout(() => {
        wsRef.current?.removeEventListener('message', handler);
        reject(new Error('Publish timed out'));
      }, PUBLISH_TIMEOUT_MS);
      wsRef.current.addEventListener('message', handler);
      wsRef.current.send(JSON.stringify({ type: 'publish', title: opts.title, notes: opts.notes, html: opts.html }));
    });
  }, []);

  /**
   * Send a title change to the server for persistence and broadcast.
   * @param {string} title
   */
  const sendTitle = useCallback((title) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'title', title }));
    }
  }, []);

  /**
   * Broadcast a comment event to peers.
   * @param {{ action: string, comment?: object, reply?: object, commentId?: number, replyId?: number }} data
   */
  const sendCommentEvent = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'comment', ...data }));
    }
  }, []);

  return { ydoc, synced, collabUsers, collabConnected, remoteCursors, sendCursor, sendSave, sendPublish, sendTitle, sendCommentEvent, canWrite };
}
