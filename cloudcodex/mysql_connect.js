/**
 * MySQL Database Connection Module
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

/**
 * Creates and returns a MySQL connection pool.
 * @returns { mysql.Pool } - MySQL connection pool
 */
function createDBConnection() {
  dotenv.config();
  const connection = mysql.createPool( {
    host: process.env.DB_HOST ?? 'localhost',
    user: process.env.DB_USER ?? 'admin',
    password: process.env.DB_PASS ?? 'admin',
    database: process.env.DB_NAME ?? 'c2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  } );
  return connection;
}

/**
 * Generates a random session token string ( alphanumeric, length 64 by default ).
 * @param { Integer } length - Desired length of the session token
 * @returns { String } - Generated session token
 */
function createNewSessionToken( length = 64 ) {
  return [ ...Array( length ) ].map( () => Math.random().toString( 36 )[ 2 ] ).join( '' );
}

/**
 * Returns a session token for the given user. 
 * If a valid session already exists, it returns the existing token.
 * If no valid session exists, it creates a new session and returns the new token.
 * @param { JSON } user - User object containing at least an 'id' property
 * @returns { String } - Session token string
 */
export async function generateSessionToken( user ) {
  let sessionToken;
  const existingSessions = await c2_query(
    `SELECT id, expires_at, user_id FROM sessions WHERE user_id = ? LIMIT 1`,
    [ user.id ]
  );

  // We found a session for this user, check if it's expired
  if ( existingSessions.length === 1 ) {
    const session = existingSessions[ 0 ];
    if ( session.expires_at < new Date() ) {
      sessionToken = createNewSessionToken(); // Generate a new token if the existing session is expired
      await c2_query(
        `UPDATE sessions SET created_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY) 
          WHERE id = ? AND user_id = ?`,
        [ session.id, user.id ]
      );
    }
    else {
      sessionToken = session.id; // Return existing token if session is still valid
    }
  }
  else {
    sessionToken = createNewSessionToken(); // Generate a new token if no existing session is found
    await c2_query(
      `INSERT INTO sessions (user_id, id, created_at, expires_at) 
        VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [ user.id, sessionToken ]
    );
  }
  return sessionToken;
}

/**
 * Executes a SQL query against the MySQL database.
 * @param { String } sql - SQL query string
 * @param { Array<any> } params - Query parameters
 * @returns { Promise<any> } - Query results
 */
export async function c2_query( sql, params ) {
  const db = createDBConnection();
  const results = await db.execute( sql, params );
  db.end();
  if ( results.length > 0 ) {
    return results[ 0 ];
  }
  return [];
}