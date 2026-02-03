/**
 * MySQL Database Connection Module
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

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

export async function c2_query( sql, params ) {
  const db = createDBConnection();
  const [ results, fields ] = await db.execute( sql, params );
  db.end();
  return results;
}