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

// Sample route
app.get( '/api/search', async ( req, res ) => {
  const query = req.query.query ?? '';
  const results = await c2_query( 'SHOW TABLES', [] );
  // res.json( { results: [ { title: 'Sample Result', description: 'This is a sample search result.' } ] } );
  res.json( { results } );
} );

ViteExpress.listen( app, 3000, () => {
  console.log( 'CloudCodex API Server is running on http://localhost:3000' );
} );