/**
 * Cloud Codex - Vite Configuration
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig( {
  plugins: [ react() ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Core framework — cached across all pages
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) {
              return 'vendor-react';
            }
            // Editor ecosystem — only loaded on Editor/ArchiveView pages
            if (id.includes('/@tiptap/') || id.includes('/prosemirror')) {
              return 'vendor-tiptap';
            }
            // Syntax highlighting — heavy, only needed by editor code blocks
            if (id.includes('/lowlight/') || id.includes('/highlight.js/')) {
              return 'vendor-highlight';
            }
            // Collaboration CRDT — only loaded on collab pages
            if (id.includes('/yjs/') || id.includes('/y-protocols/') || id.includes('/lib0/')) {
              return 'vendor-yjs';
            }
            // Markdown/HTML processing
            if (id.includes('/marked/') || id.includes('/turndown/') || id.includes('/dompurify/')) {
              return 'vendor-markup';
            }
          }
        },
      },
    },
  },
} )
