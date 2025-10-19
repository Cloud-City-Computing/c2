/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2025
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';

const app = express();

// Middleware to parse JSON requests
app.use( express.json() );

// Sample route
app.get( '/test', ( req, res ) => {
  res.send( 'Welcome to the CloudCodex API Server!' );
} );

ViteExpress.listen( app, 3000, () => {
  console.log( 'CloudCodex API Server is running on http://localhost:3000' );
} );