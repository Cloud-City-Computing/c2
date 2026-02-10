/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';
import { c2_query, generateSessionToken } from './mysql_connect.js';

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
    `SELECT p.title, p.html_content, p.created_at, u.name, p.id FROM pages p 
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.title LIKE ? OR p.html_content LIKE ? LIMIT 10`, 
    [ `%${ query }%`, `%${ query }%` ]
  );
  res.json( { results } );
} );

/**
 * Create Account API Endpoint
 * POST /api/create-account
 * Body: { username: string, password: string }
 * Creates a new user account and returns a session token on success.
 */
app.post( '/api/create-account', async ( req, res ) => {
  const { username, password, email } = req.body;
  if ( !username || !password || !email ) { // Basic validation to ensure required fields are present
    return res.status( 400 ).json( { 
      success: false, 
      message: 'Username and password are required' 
    } );
  }
  try {
    const result = await c2_query( 
      `INSERT INTO users ( name, password_hash, created_at, email ) 
        VALUES ( ?, ?, NOW(), ? )`, 
      [ username, password, username, email ] 
    );
    const userId = result.insertId;
    const user = { id: userId, name: username };
    const sessionToken = await generateSessionToken( user ); // Generate a session token for the new user
    res.json( { 
      success: true, 
      token: sessionToken, 
      user: { 
        id: userId, 
        name: username 
      } 
    } );
  }
  catch ( error ) {
    res.status( 500 ).json( { 
      success: false, 
      message: 'Error creating account. Username may already be taken.' 
    } );
  }
} );

/**
 * Login API Endpoint
 * POST /api/login
 * Body: { username: string, password: string }
 * Returns a session token on successful login.
 */
app.post( '/api/login', async ( req, res ) => {
  const { username, password } = req.body;
  const users = await c2_query( 
    `SELECT id, name FROM users WHERE name = ? AND password_hash = ? LIMIT 1`, 
    [ username, password ] 
  );
  if ( users.length === 1 ) {
    const user = users[ 0 ];
    const sessionToken = await generateSessionToken( user );
    res.json( { 
      success: true, 
      token: sessionToken, 
      user: { 
        id: user.id, 
        name: user.name 
      } 
    } );
  }
  else {
    res.status( 401 ).json( { 
      success: false, 
      message: 'Invalid credentials' 
    } );
  }
} );

/**
 * Start the Express server with Vite integration
 */
ViteExpress.listen( app, 3000, () => {
  console.log( 'CloudCodex API Server is running on http://localhost:3000' );
} );