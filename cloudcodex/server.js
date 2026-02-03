/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';
import { c2_query } from './mysql_connect.js';

const app = express();

// Middleware to parse JSON requests
app.use( express.json() );

/**
 * Search API Endpoint
 * GET /api/search?query=
 * Returns search results matching the query.
 */
app.get( '/api/search', async ( req, res ) => {
  const query = req.query.query ?? '';
  const results = await c2_query( 
    `SELECT p.title, p.html_content, p.created_at, u.name FROM pages p 
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.title LIKE ? OR p.html_content LIKE ? LIMIT 10`, 
    [ `%${ query }%`, `%${ query }%` ]
  );
  res.json( { results } );
} );

/**
 * Start the Express server with Vite integration
 */
ViteExpress.listen( app, 3000, () => {
  console.log( 'CloudCodex API Server is running on http://localhost:3000' );
} );