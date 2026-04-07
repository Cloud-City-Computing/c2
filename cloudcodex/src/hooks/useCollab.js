/**
 * useCollab — React hook for real-time collaborative editing via WebSocket.
 *
 * Manages the WebSocket lifecycle, syncs HTML content with the server,
 * tracks connected users for awareness/presence UI.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSessionTokenFromCookie } from '../util';

/**
 * @param {number|string} pageId  — The document/page ID to collaborate on
 * @param {function} onRemoteUpdate — Called with new HTML when a remote peer makes a change
 * @returns {{ collabUsers: Array, collabConnected: boolean, remoteCursors: Object, sendUpdate: function, sendCursor: function, sendSave: function, sendPublish: function, sendTitle: function, canWrite: boolean }}
 */
export default function useCollab(pageId, onRemoteUpdate, onRemoteComment, onPublished, onRemoteTitle) {
  const [collabUsers, setCollabUsers] = useState([]);
  const [collabConnected, setCollabConnected] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [remoteCursors, setRemoteCursors] = useState({});
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  const onRemoteCommentRef = useRef(onRemoteComment);
  const onPublishedRef = useRef(onPublished);
  const onRemoteTitleRef = useRef(onRemoteTitle);

  // Keep ref up to date so we don't re-create the WebSocket on every render
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate;
  }, [onRemoteUpdate]);

  useEffect(() => {
    onRemoteCommentRef.current = onRemoteComment;
  }, [onRemoteComment]);

  useEffect(() => {
    onPublishedRef.current = onPublished;
  }, [onPublished]);

  useEffect(() => {
    onRemoteTitleRef.current = onRemoteTitle;
  }, [onRemoteTitle]);

  useEffect(() => {
    if (!pageId) return;

    let disposed = false;

    function connect() {
      const token = getSessionTokenFromCookie();
      if (!token) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/collab?pageId=${pageId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send auth token as first message instead of in URL (avoids log/history exposure)
        ws.send(JSON.stringify({ type: 'auth', token }));
        if (!disposed) setCollabConnected(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'sync':
            setCanWrite(msg.canWrite);
            // Initial sync — push server HTML to the editor
            if (msg.html !== undefined && msg.html !== null) {
              onRemoteUpdateRef.current?.(msg.html);
            }
            break;

          case 'update':
            // Remote user changed the document
            onRemoteUpdateRef.current?.(msg.html);
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
            // Remote user performed a comment action
            onRemoteCommentRef.current?.(msg);
            break;

          case 'title':
            // Remote user changed the document title
            onRemoteTitleRef.current?.(msg.title);
            break;
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setCollabConnected(false);
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
    };
  }, [pageId]);

  /**
   * Send a local content update to the server for broadcast to peers.
   */
  const sendUpdate = useCallback((html) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'update', html }));
    }
  }, []);

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
   */
  const sendSave = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'save' }));
    }
  }, []);

  /**
   * Publish a formal version snapshot of the current document.
   * @param {{ title?: string, notes?: string }} [opts]
   */
  const sendPublish = useCallback((opts = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'publish', title: opts.title, notes: opts.notes }));
    }
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

  return { collabUsers, collabConnected, remoteCursors, sendUpdate, sendCursor, sendSave, sendPublish, sendTitle, sendCommentEvent, canWrite };
}
