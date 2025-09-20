/**
    * SQL script to initialize the database schema.
    * This script creates the schema for organizations, teams, users, projects, pages, versions, and permissions.
    * It defines the necessary tables and their relationships.
*/

CREATE TABLE organization(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id INT REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT REFERENCES user(id) ON DELETE SET NULL,
);

CREATE TABLE permissions(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user INT REFERENCES user(id) ON DELETE CASCADE,
  create_team BOOLEAN DEFAULT FALSE,
  create_project BOOLEAN DEFAULT FALSE,
  create_page BOOLEAN DEFAULT TRUE
);

CREATE TABLE project(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT REFERENCES user(id) ON DELETE SET NULL,
  read_access INT[] DEFAULT '[]',
  write_access INT[] DEFAULT '[]'
);

CREATE TABLE user(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  team_id INT[] DEFAULT '[]' REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE page(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id INT REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  html_content TEXT,
  parent_id INT REFERENCES page(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT REFERENCES user(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT REFERENCES user(id) ON DELETE SET NULL
  read_access INT[] DEFAULT '[]',
  write_access INT[] DEFAULT '[]'
  version INT DEFAULT 1
);

CREATE TABLE version(
  id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  page_id INT REFERENCES page(id) ON DELETE CASCADE,
  version INT NOT NULL,
  html_content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT REFERENCES user(id) ON DELETE SET NULL
  read_access INT[] DEFAULT '[]'
);
