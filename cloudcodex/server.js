/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';

const app = express();

// Middleware to parse JSON requests
app.use( express.json() );

// Sample route
app.get( '/api/search', ( req, res ) => {
  const query = req.query.q || '';
  // Here you would normally process the query and fetch results from a database
  const mockResults = [
    { title: 'Result 1', description: 'Description for result 1' },
    { title: 'Result 2', description: 'Description for result 2' },
    { title: 'Result 3', description: 'Description for result 3' },
  ];
  res.json( { results: mockResults.filter( r => r.title.includes( query ) || r.description.includes( query ) ) } );
} );

ViteExpress.listen( app, 3000, () => {
  console.log( 'CloudCodex API Server is running on http://localhost:3000' );
} );