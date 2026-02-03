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